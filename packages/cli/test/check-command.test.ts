import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	check,
	emptySnapshot,
	generateMigration,
	hejbroError,
	inArray,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import type { DriverRow, DriverSession } from "@hejbro/query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { Finding } from "../src/check/compare";
import type { Inventory } from "../src/check/inventory";
import {
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
