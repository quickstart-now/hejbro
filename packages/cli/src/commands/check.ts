import type {
	JsonValue,
	KindRegistry,
	RegisteredObjectKind,
	Snapshot,
} from "@hejbro/core";
import {
	createDefaultRegistry,
	generateMigration,
	parseSnapshot,
	requiredKeysByKind,
} from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { defineCommand } from "citty";
import type { Catalog } from "../check/catalog";
import { readCatalog } from "../check/catalog";
import type { Finding } from "../check/compare";
import { compareCatalog } from "../check/compare";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import { compareCheckConstraint } from "../check/expression";
import type { Inventory } from "../check/inventory";
import { buildInventory } from "../check/inventory";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { loadConfig, loadDeclarations } from "../loader";
import { buildRegistry } from "../presets";
import { readSnapshotFileText } from "../snapshot-file";

const CHECK_DESCRIPTION =
	"Compare your declarations against a live database's catalog, object by object.";

// The `args` block exists only so `--help` renders this one-line
// description (mirrors generate.ts's GENERATE_ARGS) -- the value is read
// by hand from `ctx.rawArgs` in `runCheck`.
const CHECK_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
} as const;

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => {
	const values = rawArgs.flatMap((token, index) => {
		if (token !== flagName) {
			return [];
		}
		const value = rawArgs[index + 1];
		if (value === undefined) {
			return [];
		}
		return [value];
	});
	return values.at(-1);
};

/**
 * The report's own statement of what it does not compare (spec: "The
 * check states the boundary of its own coverage") -- printed on every
 * run, pass or fail, never only on a clean result (which would read as a
 * guarantee this command never made).
 */
const COVERAGE_BOUNDARY_LINES: ReadonlyArray<string> = [
	"check does not compare view bodies.",
	"a declared object is checked for existence even where its contents are not otherwise compared.",
	"check's reads are not a single snapshot: opening no transaction is what keeps this command free of any driver capability, and a schema changing while check runs can produce a torn report.",
];

/** `[]` when `kind` has no declared reason, its one boundary line otherwise -- the `flatMap` callback below stays a guard clause, house style bans ternaries. */
const boundaryLineFor = (kind: RegisteredObjectKind): ReadonlyArray<string> => {
	if (kind.noCatalogObjectReason === undefined) {
		return [];
	}
	return [
		`check does not compare ${kind.kind} objects: ${kind.noCatalogObjectReason}`,
	];
};

/**
 * One boundary line per registered kind that declares
 * `noCatalogObjectReason` (#482, task 2.3) -- the CLI states no preset's
 * kind by name anywhere else; this is the one place a kind's own declared
 * reason reaches the report, sourced from the registry rather than a
 * hardcoded list.
 */
const kindCoverageBoundaryLines = (
	registry: KindRegistry,
): ReadonlyArray<string> => registry.list().flatMap(boundaryLineFor);

/**
 * Three answers, not two (4.5, spec Req1) -- "the database disagrees"
 * and "I could not find out" are different facts, and collapsing them
 * would let a read-only CI role's every "could not compare" read as a
 * real drift, or worse, get silently absorbed into a passing build.
 * `0` every declared object was compared and agreed; `1` at least one
 * genuinely differs or is missing (the stronger fact, so it wins even
 * when some other object also could not be compared); `2` nothing
 * disagreed, but at least one declared object could not be compared, or
 * the declaration set itself was empty -- never silence, and never `0`.
 */
export type CheckReport = {
	readonly exitCode: 0 | 1 | 2;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/** Exported so a test can build one explicitly (4.5, o2) -- `renderCheckReport` no longer defaults this away. */
export const EMPTY_INVENTORY: Inventory = {
	unmanagedTables: [],
	extensions: [],
};

/** `[]` when there is nothing to report -- an empty run says nothing extra, rather than printing an empty "unmanaged tables:" header every time. */
const extensionsLines = (
	extensions: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (extensions.length === 0) {
		return [];
	}
	return [`installed extensions: ${extensions.join(", ")}`];
};

/**
 * The report's own inventory section (task 5.1, spec Req5): informational
 * only, present whether or not `check` found any differences, and never
 * itself a `Finding` -- 2.1's own code set has no inventory entry,
 * because an unmanaged table or an installed extension is never a
 * difference a project is obliged to fix.
 */
const inventoryLines = (inventory: Inventory): ReadonlyArray<string> => [
	...inventory.unmanagedTables.map(
		(table) =>
			`unmanaged table (not covered by any declaration): ${table.schema}.${table.table}`,
	),
	...extensionsLines(inventory.extensions),
];

const NOT_COMPARED_CODE = "check-not-compared";

const isNotComparedFinding = (finding: Finding): boolean =>
	finding.error.code === NOT_COMPARED_CODE;

/** `1` when at least one finding is a genuine disagreement (the stronger fact, so it wins even alongside a not-compared finding); `2` only when every finding is `check-not-compared`. */
const nonEmptyFindingsExitCode = (disagreementCount: number): 1 | 2 => {
	if (disagreementCount > 0) {
		return 1;
	}
	return 2;
};

/** `""` when nothing was left uncompared -- appended to the `1` summary only when both kinds of finding are present, so a pure disagreement report reads exactly as it did before 4.5. */
const notComparedNote = (notComparedCount: number): string => {
	if (notComparedCount === 0) {
		return "";
	}
	return ` (${notComparedCount} more could not be compared -- see above)`;
};

/**
 * `1`'s summary names the disagreement count, plus a note if some other
 * object was also left uncompared (never silently absorbed into the
 * disagreement count, and never allowed to flip the exit code away from
 * `1` -- a real difference is the stronger fact). `2`'s summary is a
 * different sentence, not the same one with a different number: this run
 * did not find drift, it failed to find out, and says so, naming that
 * the per-object diagnostics above already say what would make the
 * comparison possible (`check-not-compared`'s own `Next:` clause).
 */
const summaryLine = (
	exitCode: 1 | 2,
	disagreementCount: number,
	notComparedCount: number,
): string => {
	if (exitCode === 1) {
		return `check: ${disagreementCount} finding(s)${notComparedNote(notComparedCount)} — fix the differences above and rerun \`hejbro check\`.`;
	}
	return `check: could not answer -- ${notComparedCount} declared object(s) could not be compared. Next: see the diagnostic(s) above for what would make the comparison possible, then rerun \`hejbro check\`.`;
};

/**
 * `findings[] -> CheckReport`, a pure function (no I/O) so the report's
 * own shape -- exit codes, the coverage-boundary statement, the "never a
 * diff" rule, the inventory section -- runs entirely in CI with no
 * database (`runCheck` is the only caller that ever does I/O; group 6
 * proves the real findings a live server produces). `inventory` is
 * required (4.5, o2): a defaulted one is exactly how 4.4's own gap
 * happened -- an omission no test can notice, because the default keeps
 * every existing call site green. `registry` (#482, task 2.3) is optional
 * and additive, defaulting to the core-only registry the same way
 * `compareCatalog`'s own does -- an existing call site that never
 * registers a preset kind sees the same three static boundary lines it
 * always did.
 */
export const renderCheckReport = (
	findings: ReadonlyArray<Finding>,
	inventory: Inventory,
	registry: KindRegistry = createDefaultRegistry(),
): CheckReport => {
	const boundaryLines = [
		...COVERAGE_BOUNDARY_LINES,
		...kindCoverageBoundaryLines(registry),
	];
	const inventoryFooter = inventoryLines(inventory);
	if (findings.length === 0) {
		return {
			exitCode: 0,
			stdout: [...boundaryLines, ...inventoryFooter, "check: no differences."],
			stderr: null,
		};
	}
	const notComparedCount = findings.filter(isNotComparedFinding).length;
	const disagreementCount = findings.length - notComparedCount;
	const exitCode = nonEmptyFindingsExitCode(disagreementCount);
	const diagnostics = findings.map((finding) =>
		fromHejbroError(finding.error, finding.identity),
	);
	return {
		exitCode,
		stdout: [...boundaryLines, ...inventoryFooter],
		stderr: renderDiagnostics(
			diagnostics,
			summaryLine(exitCode, disagreementCount, notComparedCount),
		),
	};
};

// Mirrors compare.ts's own internal-invariant idiom (table/column shapes
// aren't part of core's public surface -- only decodeExprNode/renderExpr/
// renderTypeNode are).
type LocalCheckSnapshot = {
	readonly name: string;
	readonly expression: JsonValue;
};
type LocalTableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly checks?: ReadonlyArray<LocalCheckSnapshot>;
};

type DeclaredCheckConstraint = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly expression: JsonValue;
};

/**
 * Every declared check constraint across *every* declared table (4.4) --
 * exported so its own test can assert the walk isn't accidentally
 * limited to the first table it sees. Group 3 built the expression
 * comparison and nothing called it until this task; an unreached
 * comparison is worse than a missing one, since every test passes and
 * the report stays silent.
 */
export const declaredCheckConstraints = (
	snapshot: Snapshot,
): ReadonlyArray<DeclaredCheckConstraint> =>
	Object.entries(snapshot.objects)
		.filter(([key]) => key.startsWith("table:"))
		.flatMap(([, node]) => {
			const tableNode = node as LocalTableSnapshot;
			return (tableNode.checks ?? []).map((checkNode) => ({
				schema: tableNode.schema,
				table: tableNode.name,
				name: checkNode.name,
				expression: checkNode.expression,
			}));
		});

/**
 * `compareCatalog` (existence/columns) plus, for every declared check
 * constraint, `compareCheckConstraint` (expression/enforcement, group
 * 3) -- merged into one findings list. Takes `session`, not a full
 * `Driver`, so a test injects a fake one with no real I/O at all;
 * `runCheck` passes its own already-open `Driver` (which structurally
 * satisfies `DriverSession`).
 */
export const compareCheckAgainstCatalog = async (
	snapshot: Snapshot,
	catalog: Catalog,
	session: DriverSession,
	registry: KindRegistry = createDefaultRegistry(),
): Promise<ReadonlyArray<Finding>> => {
	const tableFindings = compareCatalog(snapshot, catalog, registry);
	const expressionFindingLists = await Promise.all(
		declaredCheckConstraints(snapshot).map((constraint) =>
			compareCheckConstraint(
				session,
				catalog,
				constraint.schema,
				constraint.table,
				constraint.name,
				constraint.expression,
			),
		),
	);
	return [...tableFindings, ...expressionFindingLists.flat()];
};

const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/** Same identity-extraction heuristic as verify.ts/generate.ts's own copies: every message leads with the thing it's about inside the first `"..."`, or there is no object yet (a connection/driver/catalog-read failure) and `fallback` names the command instead. */
const identityFromMessage = (message: string, fallback: string): string => {
	const match = FIRST_QUOTED_SUBSTRING.exec(message);
	if (match === null) {
		return fallback;
	}
	return match[1] ?? fallback;
};

const FALLBACK_IDENTITY = "hejbro check";

/** The one precondition failure that answers "could not answer" (4.5) rather than "config/entry/connection/driver/catalog-read is broken": a declaration set with 0 objects makes every comparison vacuous, which is the same "I could not find out" fact `check-not-compared` reports per-object -- never a `1`, which would read as a real disagreement nothing here ever compared. */
const PRECONDITION_EXIT_CODE_BY_CODE: Readonly<Record<string, 1 | 2>> = {
	"check-declarations-empty": 2,
};

const preconditionExitCode = (code: string): 1 | 2 =>
	PRECONDITION_EXIT_CODE_BY_CODE[code] ?? 1;

/**
 * A precondition failure (config/entry/connection/driver/catalog-read) --
 * before any comparison ran, so it is its own early exit, never folded
 * into `findings`. Deliberately carries no `COVERAGE_BOUNDARY_LINES`:
 * that statement says what a *comparison* did not look at, and no
 * comparison ran here to have a boundary worth stating -- printing it
 * anyway would read as information about a run that never happened.
 */
const preconditionErrorReport = (error: unknown): CheckReport => {
	const checkError = asHejbroError(error);
	const diagnostic = fromHejbroError(
		checkError,
		identityFromMessage(checkError.message, FALLBACK_IDENTITY),
	);
	return {
		exitCode: preconditionExitCode(checkError.code),
		stdout: [],
		stderr: renderDiagnostics([diagnostic], null),
	};
};

/**
 * `hejbro check`'s own thin orchestration: connect (read-only), read the
 * catalog, build the declared snapshot exactly as `generate`/`verify` do
 * (the checked-in snapshot as the D81 parent, so column order matches
 * reality), compare (`compareCheckAgainstCatalog`, 4.4 -- existence/
 * columns *and* every declared check constraint's expression), build the
 * inventory section (`buildInventory`, 5.1), render. `withCheckConnection`
 * (N2) closes the connection pool whether the body returns or throws --
 * `@hejbro/pg`'s connection-string pool is never auto-closed, and this
 * command opens one, uses it once, and exits, so it is the one caller
 * that must. Every step but the last is I/O -- this function itself is
 * not tested directly (CI has no database); its own pieces
 * (`withCheckConnection`, `readCatalog`, `compareCheckAgainstCatalog`,
 * `renderCheckReport`) each are, and group 6 proves the assembled whole
 * against a real server. `importer` is test-only DI (mirrors
 * `loadCheckDriver`'s own parameter) -- `checkCommand` never passes it.
 */
export const runCheck = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	importer?: CheckDriverImporter,
): Promise<CheckReport> => {
	const urlFlag = lastFlagValue(normalizeEqualsFlags(argv), "--url");
	try {
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		const registry = buildRegistry(config);
		const diskSnapshot = parseSnapshot(
			readSnapshotFileText(cwd, config),
			requiredKeysByKind(registry),
		);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: diskSnapshot,
			registry,
		}).snapshot;
		return await withCheckConnection(
			urlFlag,
			process.env,
			async (driver) => {
				const catalog = await readCatalog(driver);
				const findings = await compareCheckAgainstCatalog(
					snapshot,
					catalog,
					driver,
					registry,
				);
				const inventory = buildInventory(snapshot, catalog);
				return renderCheckReport(findings, inventory, registry);
			},
			importer,
		);
	} catch (error) {
		return preconditionErrorReport(error);
	}
};

/** The `hejbro check` citty subcommand -- see {@link runCheck}. */
export const checkCommand = defineCommand({
	meta: {
		name: "check",
		description: CHECK_DESCRIPTION,
	},
	args: CHECK_ARGS,
	run: async (ctx) => {
		const result = await runCheck(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
