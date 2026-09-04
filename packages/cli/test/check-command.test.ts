import type { HejbroInput, Preset, Snapshot } from "@hejbro/core";
import {
	check,
	emptySnapshot,
	existingTable,
	generateMigration,
	getTableMeta,
	hejbroError,
	inArray,
	index,
	isNotNull,
	numeric,
	schema,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { Finding } from "../src/check/compare";
import type { Inventory } from "../src/check/inventory";
import { buildInventory } from "../src/check/inventory";
import {
	checkComparisonMode,
	compareCheckAgainstCatalog,
	EMPTY_INVENTORY,
	renderCheckReport,
} from "../src/commands/check";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

const missingTableFinding: Finding = {
	identity: "app.posts",
	error: hejbroError(
		"check-object-missing",
		'declared table "app.posts" was not found in the database. Next: apply the migration that creates it.',
	),
};

const typeDiffersFinding: Finding = {
	identity: "app.posts.title",
	error: hejbroError(
		"check-object-differs",
		'declared column "app.posts.title" has type "text", but the database has "character varying(120)". Next: change the declaration to match the database.',
	),
};

describe("renderCheckReport / 4.2 report and exit codes", () => {
	it("exits non-zero and names the object when a column type differs", () => {
		const report = renderCheckReport([typeDiffersFinding], EMPTY_INVENTORY);

		expect(report.exitCode).toBe(1);
		expect(report.stderr).toContain("app.posts.title");
		expect(report.stderr).toContain("check-object-differs");
	});

	it("exits zero when everything agrees", () => {
		const report = renderCheckReport([], EMPTY_INVENTORY);

		expect(report.exitCode).toBe(0);
		expect(report.stderr).toBeNull();
	});

	it("emits no diff hunk markers (@@, +++, ---) anywhere in its report", () => {
		// A report can carry object identity *and* still dump a diff -- this
		// is the assertion that would fail if it did; every other test here
		// would still pass regardless.
		const report = renderCheckReport(
			[missingTableFinding, typeDiffersFinding],
			EMPTY_INVENTORY,
		);
		const wholeReport = [...report.stdout, report.stderr ?? ""].join("\n");

		expect(wholeReport).not.toContain("@@");
		expect(wholeReport).not.toContain("+++");
		expect(wholeReport).not.toContain("---");
	});
});

const notComparedFinding: Finding = {
	identity: "app.posts.posts_status_valid",
	error: hejbroError(
		"check-not-compared",
		'declared check constraint "app.posts.posts_status_valid" could not be compared: the connected role could not run EXPLAIN. Next: confirm the connected role can run EXPLAIN against this table, then rerun `hejbro check`.',
	),
};

describe("renderCheckReport / 4.5 the exit code answers three questions", () => {
	it("exits 0 when everything agreed", () => {
		const report = renderCheckReport([], EMPTY_INVENTORY);

		expect(report.exitCode).toBe(0);
	});

	it("exits 1 when the database disagrees", () => {
		const report = renderCheckReport([typeDiffersFinding], EMPTY_INVENTORY);

		expect(report.exitCode).toBe(1);
	});

	it("exits 2 when an object could not be compared", () => {
		const report = renderCheckReport([notComparedFinding], EMPTY_INVENTORY);

		expect(report.exitCode).toBe(2);
		expect(report.stderr).toContain("could not");
	});

	it("exits 1, not 2, when a disagreement and a not-compared finding coexist -- the stronger fact wins", () => {
		const report = renderCheckReport(
			[typeDiffersFinding, notComparedFinding],
			EMPTY_INVENTORY,
		);

		expect(report.exitCode).toBe(1);
		// The summary still says some objects could not be compared, even
		// though the exit code reads as a real disagreement (cs-planner's
		// own decision: never silently absorb a not-compared finding into
		// the disagreement count without saying so).
		expect(report.stderr).toContain("could not be compared");
	});

	it("2's own diagnostics never claim a disagreement", () => {
		const report = renderCheckReport([notComparedFinding], EMPTY_INVENTORY);
		const wholeReport = [...report.stdout, report.stderr ?? ""].join("\n");

		expect(wholeReport).not.toContain("disagrees");
	});
});

describe("renderCheckReport / 4.3 coverage boundary", () => {
	it("states what it does not compare even when it finds no differences", () => {
		const report = renderCheckReport([], EMPTY_INVENTORY);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("states what it does not compare when it does find differences", () => {
		const report = renderCheckReport([typeDiffersFinding], EMPTY_INVENTORY);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("says its reads are not a single snapshot", () => {
		const report = renderCheckReport([], EMPTY_INVENTORY);
		const stdoutText = report.stdout.join("\n").toLowerCase();

		expect(stdoutText).toContain("not a single snapshot");
	});
});

describe("renderCheckReport / 5.1 inventory section", () => {
	it("prints the inventory section in the report", () => {
		const inventory: Inventory = {
			unmanagedTables: [{ schema: "app", table: "legacy_table" }],
			extensions: ["pgcrypto"],
		};

		const report = renderCheckReport([], inventory);

		// Informational (spec Req5): present even on an otherwise-clean run,
		// and never affects the exit code -- these are never differences.
		expect(report.exitCode).toBe(0);
		const stdoutText = report.stdout.join("\n");
		expect(stdoutText).toContain("app.legacy_table");
		expect(stdoutText).toContain("pgcrypto");
	});

	it("says nothing extra when there is no unmanaged inventory", () => {
		const report = renderCheckReport([], {
			unmanagedTables: [],
			extensions: [],
		});

		const stdoutText = report.stdout.join("\n");
		expect(stdoutText).not.toContain("unmanaged");
	});
});

describe("check's inventory does not widen to a whole reserved schema (D106 R3, #665)", () => {
	// Declaring one existing table in `auth` used to pull `auth`'s own
	// name into `declaredSchemaNames`, and once a schema counts as
	// "declared" every catalog table inside it that no declaration
	// covers is reported unmanaged -- three tables nobody ever declared
	// a shape or an existing marker for, purely because one sibling
	// table happened to be existing.
	it("does not report the rest of a schema as unmanaged just because one table in it is declared existing", () => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const snapshot = buildTestSnapshot([getTableMeta(authUsers)]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "auth", table: "users", rls: false },
				{ schema: "auth", table: "sessions", rls: false },
				{ schema: "auth", table: "refresh_tokens", rls: false },
				{ schema: "auth", table: "mfa_factors", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);
		expect(inventory.unmanagedTables).toEqual([]);
	});

	// Control (round 1's own form): a schema a *managed* table actually
	// declares still gets its other catalog tables reported unmanaged --
	// the fix above must narrow the existing-only case, not the
	// declared-schema rule generally.
	it("still reports an undeclared table unmanaged when the schema has a managed table", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([app, posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "app", table: "legacy_table", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);
		expect(inventory.unmanagedTables).toEqual([
			{ schema: "app", table: "legacy_table" },
		]);
	});
});

const app = schema("app");

const buildTestSnapshot = (
	declarations: ReadonlyArray<HejbroInput>,
): Snapshot =>
	generateMigration({ declarations, previousSnapshot: emptySnapshot }).snapshot;

const emptyCatalog = (): Catalog => ({
	schemas: [],
	tables: [],
	columns: [],
	constraints: [],
	indexes: [],
	enums: [],
	sequences: [],
	functions: [],
	views: [],
	policies: [],
	triggers: [],
	tableGrants: [],
	schemaUsageGrants: [],
	defaultTableGrants: [],
	extensions: [],
});

const idColumnRow = (table: string) => ({
	schema: "app",
	table,
	name: "id",
	notNull: true,
	catalogType: "uuid",
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: null,
	catalogDefault: null,
	catalogGenerated: null,
});

const statusColumnRow = (table: string) => ({
	schema: "app",
	table,
	name: "status",
	notNull: false,
	catalogType: "text",
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: null,
	catalogDefault: null,
	catalogGenerated: null,
});

/** One row of `EXPLAIN (FORMAT JSON, COSTS OFF, VERBOSE)` output, shaped exactly as a real postgres:17 returns it (same fixture shape check-expression.test.ts verified directly) -- `output` is `[declaredText, catalogText]`, the single-statement probe's own two-entry `Output`. */
const explainRow = (output: ReadonlyArray<string>): DriverRow => ({
	"QUERY PLAN": [
		{
			// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
			Plan: {
				// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
				Output: output,
			},
		},
	],
});

type ConstraintMetadata = {
	readonly expression: string;
	readonly convalidated: boolean;
};

/** A fake session answering both compareCheckConstraint's own queries (the conbin metadata lookup, keyed by constraint name in `metadataByName`) and its single-statement EXPLAIN probe -- no real I/O anywhere in these tests. */
const makeFakeSession = (
	metadataByName: ReadonlyMap<string, ConstraintMetadata>,
	explainOutputByName: ReadonlyMap<string, ReadonlyArray<string>>,
): DriverSession => ({
	execute: async (compiled) => {
		if (compiled.sql.includes("pg_constraint")) {
			const [, , constraintName] = compiled.params as ReadonlyArray<string>;
			if (constraintName === undefined) {
				return [];
			}
			const metadata = metadataByName.get(constraintName);
			if (metadata === undefined) {
				return [];
			}
			return [
				{
					expression: metadata.expression,
					convalidated: metadata.convalidated,
				},
			];
		}
		const [tableName] = [...explainOutputByName.keys()].filter((key) =>
			compiled.sql.includes(key),
		);
		if (tableName === undefined) {
			return [explainRow([])];
		}
		const output = explainOutputByName.get(tableName);
		if (output === undefined) {
			return [explainRow([])];
		}
		return [explainRow(output)];
	},
});

describe("compareCheckAgainstCatalog / 4.4 reaches the expression comparison", () => {
	it("reports a check constraint whose expression differs", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
			columns: [idColumnRow("posts"), statusColumnRow("posts")],
			constraints: [
				{
					schema: "app",
					table: "posts",
					name: "posts_status_valid",
					type: "c",
					columns: ["status"],
				},
			],
		};
		const session = makeFakeSession(
			new Map([
				[
					"posts_status_valid",
					{ expression: "status = ANY ('{a,b}'::text[])", convalidated: true },
				],
			]),
			new Map([
				[
					"posts",
					[
						"(status = ANY ('{a,b,c}'::text[]))",
						"(status = ANY ('{a,b}'::text[]))",
					],
				],
			]),
		);

		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			session,
		);

		expect(
			findings.some(
				(finding) =>
					finding.identity === "app.posts.posts_status_valid" &&
					finding.error.code === "check-object-differs",
			),
		).toBe(true);
	});

	it("compares every declared check constraint, not only the tables around them", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("comments_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts, comments]);
		const constraintRow = (constraintTable: string, name: string) => ({
			schema: "app",
			table: constraintTable,
			name,
			type: "c",
			columns: ["status"],
		});
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "app", table: "comments", rls: false },
			],
			columns: [
				idColumnRow("posts"),
				statusColumnRow("posts"),
				idColumnRow("comments"),
				statusColumnRow("comments"),
			],
			constraints: [
				constraintRow("posts", "posts_status_valid"),
				constraintRow("comments", "comments_status_valid"),
				{
					schema: "app",
					table: "posts",
					name: "posts_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "comments",
					name: "comments_pkey",
					type: "p",
					columns: ["id"],
				},
			],
		};
		const differingOutput = [
			"(status = ANY ('{a,b,c}'::text[]))",
			"(status = ANY ('{a,b}'::text[]))",
		];
		const session = makeFakeSession(
			new Map([
				[
					"posts_status_valid",
					{ expression: "status = ANY ('{a,b}'::text[])", convalidated: true },
				],
				[
					"comments_status_valid",
					{ expression: "status = ANY ('{a,b}'::text[])", convalidated: true },
				],
			]),
			new Map([
				["posts", differingOutput],
				["comments", differingOutput],
			]),
		);

		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			session,
		);

		const identities = findings.map((finding) => finding.identity).sort();
		expect(identities).toEqual(
			[
				"app.comments.comments_status_valid",
				"app.posts.posts_status_valid",
			].sort(),
		);
	});
});

describe("hejbro check --help", () => {
	beforeAll(assertBuiltCli);

	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("prints its flags", async () => {
		const result = await runCli(cwd, ["check", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--url");
	});
});

describe("hejbro check --url=<value> (equals form, #459-class defect)", () => {
	beforeAll(assertBuiltCli);

	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await runCli(cwd, ["init"]);
		await writeFixtureFile(
			cwd,
			"src/app.schema.ts",
			`import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
});
`,
		);
		await runCli(cwd, ["generate"]);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	// A stripped env (no DATABASE_URL) makes the two outcomes distinguishable
	// without a real database: if --url=... is silently dropped, connection
	// resolution finds neither flag nor DATABASE_URL and fails with
	// check-connection-missing; if accepted, it proceeds to load @hejbro/pg
	// (absent from this fixture) and fails with check-driver-missing
	// instead. The fixture project (init + a real schema + generate) is
	// required to even reach connection resolution -- runCheck loads
	// config/declarations/snapshot first.
	const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => {
		const env = { ...process.env };
		env.DATABASE_URL = undefined;
		return env;
	};

	// Group 6 (task 6.1) adds @hejbro/pg as this package's own devDependency
	// for its live-witness suite -- which makes it resolvable from this
	// very fixture for the first time (Node resolves the dynamic import
	// relative to dist/cli.js's own location, not this fixture's node_
	// modules, so the fixture's own symlinks were never what made it
	// unresolvable). Measured: with @hejbro/pg's dist built, `--url=...`
	// now reaches a real connection attempt against the literal
	// "nonexistent-host" from the URL -- 1.5's own connectivity probe
	// (assertConnected) fails before any catalog read runs, so the
	// outcome is "check-connection-failed" (`getaddrinfo ENOTFOUND
	// nonexistent-host`), not "check-catalog-unreadable". Unbuilt (a
	// fresh CI checkout before its own build step, but not guaranteed to
	// stay that way), it is "check-driver-missing" instead.
	//
	// The real invariant is not "which downstream code either form
	// reaches" (an environment fact, and asserting on it directly is
	// exactly the fragile shape cs-planner flagged) but that **both
	// forms reach the same one** -- whatever it happens to be here. If
	// --url= is ever silently dropped again, it diverges to
	// check-connection-missing while the space form does not, and this
	// fails immediately without needing to know the downstream code.
	it("--url=<value> reaches the same result as --url <value>", async () => {
		const equalsForm = await runCli(
			cwd,
			["check", "--url=postgres://user@nonexistent-host/db"],
			{ env: envWithoutDatabaseUrl() },
		);
		const spaceForm = await runCli(
			cwd,
			["check", "--url", "postgres://user@nonexistent-host/db"],
			{ env: envWithoutDatabaseUrl() },
		);

		expect(equalsForm.exitCode).toBe(spaceForm.exitCode);
		expect(equalsForm.stderr).toBe(spaceForm.stderr);
		expect(equalsForm.stdout).toBe(spaceForm.stdout);
		expect(equalsForm.stderr).not.toContain("check-connection-missing");
	});
});

describe("an existing declaration is neither compared nor inventoried (add-unmanaged-objects, 2.2)", () => {
	const noOpSession: DriverSession = {
		execute: async () => [],
	};

	// The database carries a real, differently-shaped table under this
	// identity (declared "id uuid", catalog says "integer") -- if the
	// existing skip in compare.ts didn't run first, this shape gap
	// would produce a `check-object-differs` finding on its own.
	const buildScenario = (): { snapshot: Snapshot; catalog: Catalog } => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const snapshot = buildTestSnapshot([getTableMeta(authUsers)]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "auth", table: "users", rls: false }],
			columns: [
				{
					schema: "auth",
					table: "users",
					name: "id",
					notNull: true,
					catalogType: "integer",
					baseTypeKind: null,
					baseTypeSchema: null,
					baseTypeName: null,
					catalogDefault: null,
					catalogGenerated: null,
				},
			],
		};
		return { snapshot, catalog };
	};

	// ① Independent of ②: this reads only `compareCheckAgainstCatalog`
	// (compare.ts's own existing skip), never `buildInventory` -- a
	// mutant that removes only the inventory side leaves this green.
	it("no difference is reported for it", async () => {
		const { snapshot, catalog } = buildScenario();
		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			noOpSession,
		);
		expect(findings).toEqual([]);
	});

	// ② Independent of ①: `buildInventory` never calls `compareCatalog` --
	// a mutant that removes only compare.ts's skip leaves this green (it
	// was already true before this task, since the table's identity is
	// declared either way -- see inventory.ts's own `declaredTableIdentities`).
	it("is absent from the inventory section", () => {
		const { snapshot, catalog } = buildScenario();
		const inventory = buildInventory(snapshot, catalog);
		expect(inventory.unmanagedTables).toEqual([]);
	});

	// ③ Delta's own third clause, derived from ① (a real difference would
	// also flip this) -- asserted on the same real pipeline
	// (`compareCheckAgainstCatalog` + `renderCheckReport`), not assumed
	// from ① alone.
	it("the exit code is unaffected", async () => {
		const { snapshot, catalog } = buildScenario();
		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			noOpSession,
		);
		const inventory = buildInventory(snapshot, catalog);
		const report = renderCheckReport(findings, inventory);
		expect(report.exitCode).toBe(0);
	});

	// ④ Phrase-independent of ①-③: reuses this file's own idiom (line 179's
	// "does not warn on an existingTable...") for `check`'s pre-existing
	// "unmanaged" concept -- a *declared* existing table SHALL NOT surface
	// as "unmanaged" text anywhere in the report, since that word is
	// reserved for a catalog table no declaration covers at all. A mutant
	// that made the report render the wrong section, or a stray reuse of
	// this word for the existing declaration, would show up here even if
	// ①-③ all happened to net a clean report by coincidence.
	it("the word `unmanaged` never appears in the report, even though an existing table is declared", async () => {
		const { snapshot, catalog } = buildScenario();
		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			noOpSession,
		);
		const inventory = buildInventory(snapshot, catalog);
		const report = renderCheckReport(findings, inventory);
		const wholeReport = [...report.stdout, report.stderr ?? ""].join("\n");
		expect(wholeReport).not.toContain("unmanaged");
	});

	// D106 R2-08/R2-09/R2-11: "The check states the boundary of its own
	// coverage" (cli-commands, live requirement) requires naming what it
	// did not compare regardless of the reason -- an existing table's skip
	// is neither of that requirement's two named categories (not a
	// kind-level incapacity: `table` compares fine for every other
	// declaration; not an operational failure: nothing failed, this was
	// never attempted by design), but the requirement's own opening
	// sentence is not scoped to only those two, and the report said
	// nothing about it before this fix. The delta's own scenario names
	// four THEN clauses (naming, not a finding, absent from the unmanaged
	// inventory, exit code unaffected) -- a fourth, "not counted as
	// agreeing", was cut mid-round (R2-11) once measuring
	// `renderCheckReport` showed this report has no agree-count anywhere
	// to be counted under, which would have made that clause an
	// unobserved claim (evaluation.md's own N2 shape, the one this piece
	// has avoided throughout). Each of the four remaining clauses gets its
	// own assertion (round 1's own convention), so a mutant removing only
	// one leaves the other three green. Passes the real `snapshot` (the
	// 4th, previously-unexercised parameter) rather than relying on the
	// `emptySnapshot` default every other test in this file uses.
	const buildCoverageBoundaryReport = async (): Promise<{
		readonly report: ReturnType<typeof renderCheckReport>;
		readonly findings: ReadonlyArray<Finding>;
		readonly inventory: Inventory;
	}> => {
		const { snapshot, catalog } = buildScenario();
		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			noOpSession,
		);
		const inventory = buildInventory(snapshot, catalog);
		const report = renderCheckReport(findings, inventory, undefined, snapshot);
		return { report, findings, inventory };
	};

	// ⑤ Names the table, in the coverage-boundary section's own
	// established style ("check does not compare X: reason") -- never
	// `inventoryLines`' "unmanaged" wording (④ above already established
	// the report never calls a declared table that; this line only
	// confirms the *positive* claim, that it names it some other way).
	it("names the table in the coverage-boundary section", async () => {
		const { report } = await buildCoverageBoundaryReport();
		const stdoutText = report.stdout.join("\n");
		expect(stdoutText).toContain(
			"check does not compare auth.users: declared existing and not compared.",
		);
	});

	// ⑥ Not a finding: the boundary line is additive to the report's
	// stdout, never derived from `findings` -- the table contributes zero
	// findings of any kind (not a difference, not a `check-not-compared`).
	// Restates ① above (same fact) so this describe block proves the
	// scenario's own clauses on its own.
	it("is not a finding", async () => {
		const { findings } = await buildCoverageBoundaryReport();
		expect(findings).toEqual([]);
	});

	// ⑦ Restates ② above (same fact, absent from the unmanaged inventory)
	// alongside the other three clauses so this describe block proves the
	// whole scenario on its own, without a reader having to
	// cross-reference the block above it.
	it("is absent from the unmanaged inventory", async () => {
		const { inventory } = await buildCoverageBoundaryReport();
		expect(inventory.unmanagedTables).toEqual([]);
	});

	// ⑧ Restates ③ above (same fact) for the same reason as ⑦.
	it("does not affect the exit code", async () => {
		const { report } = await buildCoverageBoundaryReport();
		expect(report.exitCode).toBe(0);
	});
});

/**
 * fix-nile-findings, #755, task 2.3: `checkComparisonMode` reads only the
 * presets the configuration registers -- its own signature (`presets`,
 * never a driver/connection) makes "and from nowhere else" (cli-commands
 * spec) structural, not just documented.
 */
describe("checkComparisonMode (fix-nile-findings, #755)", () => {
	const fakePresetDeclaringExplainUnavailable: Preset = {
		name: "fake",
		kinds: [],
		validators: [],
		explainUnavailable: true,
	};
	const fakePresetSilentOnIt: Preset = {
		name: "fake",
		kinds: [],
		validators: [],
	};

	it("is 'text' when a registered preset declares explainUnavailable", () => {
		expect(checkComparisonMode([fakePresetDeclaringExplainUnavailable])).toBe(
			"text",
		);
	});

	it("is 'server' when no registered preset declares it (silence means the platform can plan)", () => {
		expect(checkComparisonMode([fakePresetSilentOnIt])).toBe("server");
	});

	it("is 'server' for no presets at all", () => {
		expect(checkComparisonMode([])).toBe("server");
	});
});

/**
 * fix-nile-findings, #755, task 2.3: mode threaded end to end through
 * `compareCheckAgainstCatalog` and `renderCheckReport` -- the CLI
 * boundary a fake `explainUnavailable` preset exercises (constructor
 * mode's own catalog-text fixtures are 2.4's Docker witness; this is the
 * mode-selection wiring only).
 */
describe("compareCheckAgainstCatalog / renderCheckReport text mode (fix-nile-findings, #755)", () => {
	const nameCheckCatalog = (): Catalog => ({
		...emptyCatalog(),
		tables: [{ schema: "app", table: "posts", rls: false }],
		columns: [idColumnRow("posts")],
		constraints: [
			{
				schema: "app",
				table: "posts",
				name: "posts_name_check",
				type: "c",
				columns: ["name"],
			},
		],
	});

	const buildNameCheckSnapshot = (): Snapshot =>
		buildTestSnapshot([
			table(app, "posts", { id: uuid().primaryKey(), name: text() }, (t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			})),
		]);

	/** Tracks every statement the session receives, so a test can assert on `explain` presence/absence directly, the same guard 3.2/3.3 established in check-expression.test.ts. */
	const makeTrackedFakeSession = (
		expression: string,
	): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
		const calls: CompileResult[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled);
				if (compiled.sql.includes("pg_constraint")) {
					return [{ expression, convalidated: true }];
				}
				return [explainRow(["irrelevant"])];
			},
		};
		return { session, calls };
	};

	it("never issues an explain statement when mode is text", async () => {
		const { session, calls } = makeTrackedFakeSession('"name" is not null');

		await compareCheckAgainstCatalog(
			buildNameCheckSnapshot(),
			nameCheckCatalog(),
			session,
			undefined,
			"text",
		);

		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});

	it("issues an explain statement exactly as before when mode is server (regression guard)", async () => {
		const { session, calls } = makeTrackedFakeSession('"name" is not null');

		await compareCheckAgainstCatalog(
			buildNameCheckSnapshot(),
			nameCheckCatalog(),
			session,
			undefined,
			"server",
		);

		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(1);
	});

	it("states the text-comparison boundary line only when mode is text", () => {
		const textReport = renderCheckReport(
			[],
			EMPTY_INVENTORY,
			undefined,
			undefined,
			"text",
		);
		const serverReport = renderCheckReport([], EMPTY_INVENTORY);

		expect(
			textReport.stdout.some((line) =>
				line.includes("compared by normalized text"),
			),
		).toBe(true);
		expect(
			serverReport.stdout.some((line) =>
				line.includes("compared by normalized text"),
			),
		).toBe(false);
	});

	it("a text-mode not-compared finding does not exit zero (the exit-code rule itself is unchanged, finding-based)", async () => {
		// A genuinely different expression (opposite negation) the fixed
		// normalization cannot and must not reconcile.
		const { session } = makeTrackedFakeSession('"name" is null');

		const findings = await compareCheckAgainstCatalog(
			buildNameCheckSnapshot(),
			nameCheckCatalog(),
			session,
			undefined,
			"text",
		);

		expect(
			findings.some((finding) => finding.error.code === "check-not-compared"),
		).toBe(true);

		const report = renderCheckReport(
			findings,
			EMPTY_INVENTORY,
			undefined,
			undefined,
			"text",
		);
		expect(report.exitCode).not.toBe(0);
	});
});

/**
 * #778/#781, task 1.6: an index's predicate and expression column, and a
 * generated column's expression, reach the same run a check constraint's
 * always did -- `declaredIndexExpressions`/`declaredGeneratedColumns`
 * merged into `compareCheckAgainstCatalog`. One index carries both a
 * partial predicate and an expression column, so its own probe is one
 * `explain` statement regardless of how many pairs it carries (1.5); the
 * generated column is the second and last object, so "one per object"
 * is exactly two statements total, with no check constraint declared at
 * all.
 */
describe("compareCheckAgainstCatalog / 1.6 every expression surface reaches the run", () => {
	const buildWidgetsSnapshot = (): Snapshot =>
		buildTestSnapshot([
			table(
				app,
				"widgets",
				{
					id: uuid().primaryKey(),
					email: text(),
					archivedAt: timestamptz(),
					price: numeric(),
					qty: numeric(),
					total: numeric().generatedAlwaysAs(sql`price * qty`),
				},
				(t) => ({
					indexes: [
						index("widgets_email_idx")
							.on(sql`lower(${t.email})`)
							.where(isNotNull(t.archivedAt)),
					],
				}),
			),
		]);

	const numericColumnRow = (name: string, catalogGenerated: string | null) => ({
		schema: "app",
		table: "widgets",
		name,
		notNull: false,
		catalogType: "numeric",
		baseTypeKind: null,
		baseTypeSchema: null,
		baseTypeName: null,
		catalogDefault: null,
		catalogGenerated,
	});

	const widgetsCatalog = (): Catalog => ({
		...emptyCatalog(),
		tables: [{ schema: "app", table: "widgets", rls: false }],
		constraints: [
			{
				schema: "app",
				table: "widgets",
				name: "widgets_pkey",
				type: "p",
				columns: ["id"],
			},
		],
		columns: [
			idColumnRow("widgets"),
			{
				schema: "app",
				table: "widgets",
				name: "email",
				notNull: false,
				catalogType: "text",
				baseTypeKind: null,
				baseTypeSchema: null,
				baseTypeName: null,
				catalogDefault: null,
				catalogGenerated: null,
			},
			{
				schema: "app",
				table: "widgets",
				name: "archived_at",
				notNull: false,
				catalogType: "timestamp with time zone",
				baseTypeKind: null,
				baseTypeSchema: null,
				baseTypeName: null,
				catalogDefault: null,
				catalogGenerated: null,
			},
			numericColumnRow("price", null),
			numericColumnRow("qty", null),
			numericColumnRow("total", "(price * (qty)::numeric)"),
		],
		indexes: [
			{
				schema: "app",
				table: "widgets",
				name: "widgets_email_idx",
				predicate: "(archived_at IS NOT NULL)",
				keys: [{ text: "lower(email)", expression: true }],
			},
		],
	});

	/** Routes by a substring unique to each object's own probe SQL -- `qty` only ever appears in the generated column's select list, `email` only in the index's (its predicate and its expression column both reference `archived_at`/`email`, never `qty`). No `pg_constraint` lookup exists for either surface. */
	const makeSurfaceFakeSession = (
		indexOutput: ReadonlyArray<string>,
		generatedOutput: ReadonlyArray<string>,
	): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
		const calls: CompileResult[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled);
				if (compiled.sql.includes("qty")) {
					return [explainRow(generatedOutput)];
				}
				if (compiled.sql.includes("email")) {
					return [explainRow(indexOutput)];
				}
				return [explainRow([])];
			},
		};
		return { session, calls };
	};

	it("issues exactly two explain statements in server mode, one per object", async () => {
		const { session, calls } = makeSurfaceFakeSession(
			[
				"(archived_at IS NOT NULL)",
				"(archived_at IS NOT NULL)",
				"lower(email)",
				"lower(email)",
			],
			["(price * (qty)::numeric)", "(price * (qty)::numeric)"],
		);

		await compareCheckAgainstCatalog(
			buildWidgetsSnapshot(),
			widgetsCatalog(),
			session,
		);

		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(2);
	});

	it("issues no explain statement in text mode", async () => {
		const { session, calls } = makeSurfaceFakeSession([], []);

		await compareCheckAgainstCatalog(
			buildWidgetsSnapshot(),
			widgetsCatalog(),
			session,
			undefined,
			"text",
		);

		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});

	it("exits 0 and names no column when every surface agrees (#781 end-to-end)", async () => {
		const { session } = makeSurfaceFakeSession(
			[
				"(archived_at IS NOT NULL)",
				"(archived_at IS NOT NULL)",
				"lower(email)",
				"lower(email)",
			],
			["(price * (qty)::numeric)", "(price * (qty)::numeric)"],
		);

		const findings = await compareCheckAgainstCatalog(
			buildWidgetsSnapshot(),
			widgetsCatalog(),
			session,
		);
		const report = renderCheckReport(findings, EMPTY_INVENTORY);

		expect(report.exitCode).toBe(0);
		expect(findings.some((finding) => finding.identity.includes("total"))).toBe(
			false,
		);
	});

	it("names every expression surface in the text-mode coverage boundary", () => {
		const report = renderCheckReport(
			[],
			EMPTY_INVENTORY,
			undefined,
			undefined,
			"text",
		);

		expect(
			report.stdout.some((line) =>
				line.includes(
					"expressions (check constraints, index predicates and expression columns, generated columns) were compared by normalized text",
				),
			),
		).toBe(true);
	});
});

/**
 * Review round 1, B1/B2 (`.blackbox/778/` R3): `declaredIndexExpressions`'s
 * own filter used to skip a declared index that carries neither a
 * predicate nor an expression column, so a database index that grew one
 * (or a partial predicate) the declaration never had passed as "no
 * differences" -- the filter never let `compareIndexKeys` even run for
 * that index. This pins the fix directly through
 * `compareCheckAgainstCatalog`, the seam the bug actually lived in.
 */
describe("compareCheckAgainstCatalog / 1.10 every declared index reaches the key comparison (review B1/B2)", () => {
	const textColumnRow = (name: string) => ({
		schema: "app",
		table: "widgets",
		name,
		notNull: false,
		catalogType: "text",
		baseTypeKind: null,
		baseTypeSchema: null,
		baseTypeName: null,
		catalogDefault: null,
		catalogGenerated: null,
	});

	const widgetsCatalogWithIndex = (indexRow: {
		readonly predicate: string | null;
		readonly keys: { readonly text: string; readonly expression: boolean }[];
	}): Catalog => ({
		...emptyCatalog(),
		tables: [{ schema: "app", table: "widgets", rls: false }],
		constraints: [
			{
				schema: "app",
				table: "widgets",
				name: "widgets_pkey",
				type: "p",
				columns: ["id"],
			},
		],
		columns: [
			idColumnRow("widgets"),
			textColumnRow("a"),
			textColumnRow("status"),
		],
		indexes: [
			{ schema: "app", table: "widgets", name: "widgets_idx", ...indexRow },
		],
	});

	/** `explainOutput` defaults to an empty `Output` -- fine for the two scenarios here that short-circuit on the count or presence guard before any statement is sent; the one scenario whose shape agrees and reaches a real probe (a genuinely differing pair) supplies its own mismatched pair. */
	const makeIndexOnlySession = (
		explainOutput?: ReadonlyArray<string>,
	): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
		const calls: CompileResult[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled);
				return [explainRow(explainOutput ?? [])];
			},
		};
		return { session, calls };
	};

	it("reports a declared plain index against a catalog index on lower(a)", async () => {
		const snapshot = buildTestSnapshot([
			table(app, "widgets", { id: uuid().primaryKey(), a: text() }, (t) => ({
				indexes: [index("widgets_idx").on(t.a)],
			})),
		]);
		const catalog = widgetsCatalogWithIndex({
			predicate: null,
			keys: [{ text: "lower(a)", expression: true }],
		});
		// The count (1 vs 1) and predicate presence (neither) both agree, so
		// this position is genuinely probed (the declared plain column against
		// the catalog's expression key) -- a mismatched pair, exactly the
		// finding this scenario exists to catch.
		const { session, calls } = makeIndexOnlySession(["a", "lower(a)"]);

		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			session,
		);

		const indexFindings = findings.filter(
			(finding) => finding.identity === "app.widgets.widgets_idx",
		);
		expect(indexFindings).toHaveLength(1);
		expect(indexFindings[0]?.error).toMatchObject({
			code: "check-object-differs",
		});
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(1);
	});

	it("reports a declared totally plain index against a catalog partial one", async () => {
		const snapshot = buildTestSnapshot([
			table(
				app,
				"widgets",
				{ id: uuid().primaryKey(), a: text(), status: text() },
				(t) => ({ indexes: [index("widgets_idx").on(t.a)] }),
			),
		]);
		const catalog = widgetsCatalogWithIndex({
			predicate: "(status <> 'archived'::text)",
			keys: [{ text: "a", expression: false }],
		});
		const { session, calls } = makeIndexOnlySession();

		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			session,
		);

		const indexFindings = findings.filter(
			(finding) => finding.identity === "app.widgets.widgets_idx",
		);
		expect(indexFindings).toHaveLength(1);
		expect(indexFindings[0]?.error).toMatchObject({
			code: "check-object-differs",
		});
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});

	it("issues no statement and no finding when a plain index matches a plain catalog index", async () => {
		const snapshot = buildTestSnapshot([
			table(app, "widgets", { id: uuid().primaryKey(), a: text() }, (t) => ({
				indexes: [index("widgets_idx").on(t.a)],
			})),
		]);
		const catalog = widgetsCatalogWithIndex({
			predicate: null,
			keys: [{ text: "a", expression: false }],
		});
		const { session, calls } = makeIndexOnlySession();

		const findings = await compareCheckAgainstCatalog(
			snapshot,
			catalog,
			session,
		);

		expect(
			findings.filter(
				(finding) => finding.identity === "app.widgets.widgets_idx",
			),
		).toEqual([]);
		expect(
			calls.filter((call) =>
				call.sql.trim().toLowerCase().startsWith("explain"),
			),
		).toEqual([]);
	});
});
