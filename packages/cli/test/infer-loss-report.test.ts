import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { LossReportFacts } from "../src/infer/loss-report";
import {
	buildLossReport,
	detectNextvalDefaultApproximations,
	detectUniqueIndexApproximations,
} from "../src/infer/loss-report";
import type { InferredTableFacts } from "../src/infer/table";

const emptyFacts = (command: "import" | "pull"): LossReportFacts => ({
	command,
	roleNames: [],
	notInferred: {
		functions: [],
		triggers: [],
		views: [],
		policies: [],
		grantsBeyondRoleName: true,
	},
	standaloneSequences: [],
	typeLosses: [],
	uniqueIndexApproximations: [],
	nextvalDefaults: [],
	undeclarableNameColumns: [],
});

describe("buildLossReport / 1.7", () => {
	it("names exactly the delta's not-inferred elements when every kind is present", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			notInferred: {
				functions: [{ schema: "app", name: "touch_updated_at" }],
				triggers: [{ schema: "app", table: "posts", name: "posts_touch" }],
				views: [{ schema: "app", name: "open_tasks" }],
				policies: [{ schema: "app", table: "posts", name: "posts_read_all" }],
				grantsBeyondRoleName: true,
			},
			standaloneSequences: [{ schema: "app", name: "orphan_seq" }],
			typeLosses: [
				{
					schema: "app",
					table: "widgets",
					column: "location",
					sqlType: "point",
				},
			],
		});

		expect(report.some((line) => line.includes("function"))).toBe(true);
		expect(report.some((line) => line.includes("trigger"))).toBe(true);
		expect(report.some((line) => line.includes("view"))).toBe(true);
		expect(report.some((line) => line.includes("policy"))).toBe(true);
		expect(
			report.some((line) => line.includes("grants beyond their role name")),
		).toBe(true);
		expect(report.some((line) => line.includes("app.orphan_seq"))).toBe(true);
		expect(
			report.some((line) =>
				line.includes('app.widgets.location" (type "point"'),
			),
		).toBe(true);
	});

	it("names the UNIQUE-constraint-as-index approximation", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			uniqueIndexApproximations: [
				{ schema: "app", table: "pairs", name: "pairs_a_b_unique" },
			],
		});

		expect(
			report.some(
				(line) =>
					line.includes("pairs_a_b_unique") &&
					line.includes("create unique index") &&
					line.includes("add constraint"),
			),
		).toBe(true);
	});

	it("names the nextval-default approximation", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			nextvalDefaults: [
				{
					schema: "app",
					table: "legacy",
					column: "id",
					sequence: "legacy_id_seq",
				},
			],
		});

		expect(
			report.some(
				(line) => line.includes("nextval") && line.includes("legacy_id_seq"),
			),
		).toBe(true);
	});

	it("import: names an undeclarable-name column, its table, and the exact consequence", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			undeclarableNameColumns: [
				{ schema: "app", table: "widgets", sqlName: "createdAt" },
			],
		});

		const line = report.find((entry) => entry.includes("createdAt"));
		expect(line).toBeDefined();
		expect(line).toContain("app.widgets");
		expect(line).toContain("only partly declared");
		expect(line).toContain("check");
		expect(line).toContain("declared by hand or renamed in the database");
	});

	it("pull: names an undeclarable-name column too (CI-G1-R1-16: contract/emit.ts drops any table fact with no matching snapshot node), with its own consequence", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			undeclarableNameColumns: [
				{ schema: "app", table: "widgets", sqlName: "createdAt" },
			],
		});

		const line = report.find((entry) => entry.includes("createdAt"));
		expect(line).toBeDefined();
		expect(line).toContain("app.widgets");
		// pull's own wording differs from import's: the column cannot reach
		// the contract at all (never "declared by hand or renamed").
		expect(line).toContain("cannot be carried in the contract");
		expect(line).not.toContain("only partly declared");
		expect(
			report.some((entry) => entry.includes("link the schema repository")),
		).toBe(true);
	});

	it("import: says the way out is hand-editing the starter declarations", () => {
		const report = buildLossReport(emptyFacts("import"));

		expect(report.some((line) => line.includes("hand-edit"))).toBe(true);
	});
});

describe("detectUniqueIndexApproximations / 1.7", () => {
	it("names every UNIQUE constraint, since each is inferred as its own backing index (CI-G1-R1-06 (B))", () => {
		const catalog: Catalog = {
			schemas: [],
			tables: [],
			columns: [],
			constraints: [
				{
					schema: "app",
					table: "pairs",
					name: "pairs_a_b_unique",
					type: "u",
					columns: ["a", "b"],
				},
				{
					schema: "app",
					table: "pairs",
					name: "pairs_pkey",
					type: "p",
					columns: ["id"],
				},
			],
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
		};

		expect(detectUniqueIndexApproximations(catalog)).toEqual([
			{ schema: "app", table: "pairs", name: "pairs_a_b_unique" },
		]);
	});
});

describe("detectNextvalDefaultApproximations / 1.7", () => {
	it("names a nextval default only on a column that does not own that sequence", () => {
		const tables: ReadonlyArray<InferredTableFacts> = [
			{
				schema: { declarationKind: "schema", schemaName: "app" },
				tableName: "legacy",
				columns: [
					{
						sqlName: "id",
						tsKey: "id",
						isPrimaryKey: true,
						facts: {
							schema: "app",
							table: "legacy",
							name: "id",
							sqlType: "integer",
							baseTypeName: "int4",
							isArray: false,
							notNull: true,
							catalogDefault: "nextval('app.legacy_id_seq'::regclass)",
							identityKind: "",
							generatedKind: "",
							identityOptions: null,
							isSerialOwned: true,
							enumDeclaration: null,
						},
					},
					{
						sqlName: "external_id",
						tsKey: "externalId",
						isPrimaryKey: false,
						facts: {
							schema: "app",
							table: "legacy",
							name: "external_id",
							sqlType: "integer",
							baseTypeName: "int4",
							isArray: false,
							notNull: false,
							catalogDefault: "nextval('app.orphan_seq'::regclass)",
							identityKind: "",
							generatedKind: "",
							identityOptions: null,
							isSerialOwned: false,
							enumDeclaration: null,
						},
					},
				],
				foreignKeys: [],
				checks: [],
				indexes: [],
			},
		];

		expect(detectNextvalDefaultApproximations(tables)).toEqual([
			{
				schema: "app",
				table: "legacy",
				column: "external_id",
				sequence: "app.orphan_seq",
			},
		]);
	});
});
