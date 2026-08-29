import {
	generateMigration,
	parseSnapshot,
	requiredKeysByKind,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { readCatalog } from "../check/catalog";
import type { Finding } from "../check/compare";
import { compareCatalog } from "../check/compare";
import { connectForCheck } from "../check/driver";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
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

export type CheckReport = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/**
 * `findings[] -> CheckReport`, a pure function (no I/O) so the report's
 * own shape -- exit codes, the coverage-boundary statement, the "never a
 * diff" rule -- runs entirely in CI with no database (`runCheck` is the
 * only caller that ever does I/O; group 6 proves the real findings a live
 * server produces).
 */
export const renderCheckReport = (
	findings: ReadonlyArray<Finding>,
): CheckReport => {
	if (findings.length === 0) {
		return {
			exitCode: 0,
			stdout: [...COVERAGE_BOUNDARY_LINES, "check: no differences."],
			stderr: null,
		};
	}
	const diagnostics = findings.map((finding) =>
		fromHejbroError(finding.error, finding.identity),
	);
	return {
		exitCode: 1,
		stdout: [...COVERAGE_BOUNDARY_LINES],
		stderr: renderDiagnostics(
			diagnostics,
			`check: ${findings.length} finding(s) — fix the differences above and rerun \`hejbro check\`.`,
		),
	};
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

/** A precondition failure (config/entry/connection/driver/catalog-read) -- before any comparison ran, so it is its own early exit, never folded into `findings`. */
const preconditionErrorReport = (error: unknown): CheckReport => {
	const checkError = asHejbroError(error);
	const diagnostic = fromHejbroError(
		checkError,
		identityFromMessage(checkError.message, FALLBACK_IDENTITY),
	);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics([diagnostic], null),
	};
};

/**
 * `hejbro check`'s own thin orchestration: connect (read-only), read the
 * catalog, build the declared snapshot exactly as `generate`/`verify` do
 * (the checked-in snapshot as the D81 parent, so column order matches
 * reality), compare, render. Every step but the last is I/O -- this
 * function itself is not tested directly (CI has no database); its own
 * pieces (`connectForCheck`, `readCatalog`, `compareCatalog`,
 * `renderCheckReport`) each are, and group 6 proves the assembled whole
 * against a real server.
 */
export const runCheck = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
): Promise<CheckReport> => {
	const urlFlag = lastFlagValue(argv, "--url");
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
		const driver = await connectForCheck(urlFlag, process.env);
		const catalog = await readCatalog(driver);
		const findings = compareCatalog(snapshot, catalog);
		return renderCheckReport(findings);
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
