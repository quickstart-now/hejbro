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
import {
	compareCheckAgainstCatalog,
	renderCheckReport,
} from "../src/commands/check";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
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
		const report = renderCheckReport([typeDiffersFinding]);

		expect(report.exitCode).toBe(1);
		expect(report.stderr).toContain("app.posts.title");
		expect(report.stderr).toContain("check-object-differs");
	});

	it("exits zero when everything agrees", () => {
		const report = renderCheckReport([]);

		expect(report.exitCode).toBe(0);
		expect(report.stderr).toBeNull();
	});

	it("emits no diff hunk markers (@@, +++, ---) anywhere in its report", () => {
		// A report can carry object identity *and* still dump a diff -- this
		// is the assertion that would fail if it did; every other test here
		// would still pass regardless.
		const report = renderCheckReport([missingTableFinding, typeDiffersFinding]);
		const wholeReport = [...report.stdout, report.stderr ?? ""].join("\n");

		expect(wholeReport).not.toContain("@@");
		expect(wholeReport).not.toContain("+++");
		expect(wholeReport).not.toContain("---");
	});
});

describe("renderCheckReport / 4.3 coverage boundary", () => {
	it("states what it does not compare even when it finds no differences", () => {
		const report = renderCheckReport([]);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("states what it does not compare when it does find differences", () => {
		const report = renderCheckReport([typeDiffersFinding]);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("says its reads are not a single snapshot", () => {
		const report = renderCheckReport([]);
		const stdoutText = report.stdout.join("\n").toLowerCase();

		expect(stdoutText).toContain("not a single snapshot");
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
