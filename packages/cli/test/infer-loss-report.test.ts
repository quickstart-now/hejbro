import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { LossReportFacts } from "../src/infer/loss-report";
import {
	buildLossReport,
	detectForeignKeyNameApproximations,
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
	foreignKeyNameApproximations: [],
	undeclarableNameColumns: [],
	omittedSchemas: [],
	omittedTables: [],
	omittedIndexes: [],
	omittedChecks: [],
	omittedForeignKeys: [],
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

	it("names the expression-as-raw-SQL approximation, unconditionally (info msg after CI-G2-R1-06: third approximation, Q4 follow-up)", () => {
		const report = buildLossReport(emptyFacts("import"));

		expect(
			report.some(
				(line) =>
					line.startsWith("Approximated:") &&
					line.includes("raw SQL text") &&
					line.includes("typed builders"),
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

	it("names the foreign-key-derived-name approximation (D106 R3-B3)", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			foreignKeyNameApproximations: [
				{
					schema: "app",
					table: "comments",
					catalogName: "Comments_PostId_FK",
					derivedName: "comments_post_id_fk",
				},
			],
		});

		expect(
			report.some(
				(line) =>
					line.includes("Comments_PostId_FK") &&
					line.includes("comments_post_id_fk") &&
					line.startsWith("Approximated:"),
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

	/**
	 * catalog-inference delta, "The report names the way out" (its own
	 * scenario names `pull --db-url` specifically) -- the unit-level half
	 * of the pair with `live-witness.integration.test.ts`'s own real
	 * `hejbro pull` run: this pins the exact wording so a change to it
	 * goes red here first, the live run second.
	 */
	it("pull: says the loss ends when the consumer links the schema repository", () => {
		const report = buildLossReport(emptyFacts("pull"));

		expect(report.at(-1)).toBe(
			"The loss ends when you link the schema repository.",
		);
	});

	/**
	 * D106 N3: nothing sorted the per-instance loss lines before this --
	 * `typeLosses`/`standaloneSequences`/`uniqueIndexApproximations`/
	 * `nextvalDefaults`/`undeclarableNameColumns` all followed whatever
	 * order the catalog happened to return their source rows in. Fed here
	 * in deliberately unsorted order; the report must still read
	 * alphabetically by schema.table.column regardless.
	 */
	it("orders every per-instance loss line by schema.table.column, regardless of the order the facts arrived in", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			typeLosses: [
				{ schema: "app", table: "widgets", column: "z_col", sqlType: "point" },
				{ schema: "app", table: "widgets", column: "a_col", sqlType: "point" },
			],
			standaloneSequences: [
				{ schema: "app", name: "z_seq" },
				{ schema: "app", name: "a_seq" },
			],
			uniqueIndexApproximations: [
				{ schema: "app", table: "widgets", name: "z_key" },
				{ schema: "app", table: "widgets", name: "a_key" },
			],
		});

		const typeLossLines = report.filter((line) =>
			line.includes("no column builder expresses it"),
		);
		expect(typeLossLines).toHaveLength(2);
		expect(typeLossLines[0]).toContain("a_col");
		expect(typeLossLines[1]).toContain("z_col");

		const sequenceLines = report.filter((line) =>
			line.includes("no column owns it"),
		);
		expect(sequenceLines[0]).toContain("a_seq");
		expect(sequenceLines[1]).toContain("z_seq");

		const approximationLines = report.filter((line) =>
			line.includes("is inferred as a unique index"),
		);
		expect(approximationLines[0]).toContain("a_key");
		expect(approximationLines[1]).toContain("z_key");
	});

	// D106 R4-B1: a table, schema, index or check whose catalog name is not
	// a valid hejbro SQL identifier is omitted, never aborts the reading --
	// named here with its identity and the consequence, mirroring the
	// undeclarable-name-column pair above.
	it("import: names an omitted schema and says check will not list its tables either, since nothing in it is declared", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			omittedSchemas: [{ sqlName: "App" }],
		});

		const line = report.find((entry) => entry.includes('schema "App"'));
		expect(line).toBeDefined();
		expect(line).toContain("not a valid hejbro SQL identifier");
		expect(line).toContain("are not inferred either");
		expect(line).toContain("will not list them");
	});

	it("pull: names an omitted schema with its own contract-facing consequence", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			omittedSchemas: [{ sqlName: "App" }],
		});

		const line = report.find((entry) => entry.includes('schema "App"'));
		expect(line).toBeDefined();
		expect(line).toContain("can be carried in the contract");
		expect(line).not.toContain("left undeclared");
	});

	it("import: names an omitted table whose schema still has another declared table, and says check keeps listing it as unmanaged", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			omittedTables: [
				{ schema: "app", sqlName: "Widgets", stillReportedInInventory: true },
			],
		});

		const line = report.find((entry) => entry.includes('table "app.Widgets"'));
		expect(line).toBeDefined();
		expect(line).toContain("not a valid hejbro SQL identifier");
		expect(line).toContain("left undeclared");
		expect(line).toContain("unmanaged-table inventory");
	});

	// D106 R4-B3/#707: the report's own wording must not claim an
	// ongoing signal that doesn't exist -- when the omitted table was
	// the only thing its schema would have declared, `check`'s own
	// inventory never scans that schema at all (`declaredSchemaNames`
	// needs another declared object to anchor on), so the line must say
	// so instead of repeating the "check keeps listing it" claim above.
	it("import: names an omitted table whose schema has no other declaration, and does NOT claim check keeps listing it", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			omittedTables: [
				{ schema: "app", sqlName: "Widgets", stillReportedInInventory: false },
			],
		});

		const line = report.find((entry) => entry.includes('table "app.Widgets"'));
		expect(line).toBeDefined();
		expect(line).not.toContain("unmanaged-table inventory");
		expect(line).toContain("only thing that schema would have declared");
	});

	it("pull: names an omitted table with its own contract-facing consequence", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			omittedTables: [
				{ schema: "app", sqlName: "Widgets", stillReportedInInventory: true },
			],
		});

		const line = report.find((entry) => entry.includes('table "app.Widgets"'));
		expect(line).toBeDefined();
		expect(line).toContain("cannot be carried in the contract");
		expect(line).not.toContain("left undeclared");
	});

	// D106 R6-B1: the line's own reason must match what actually happened
	// -- the target was never "left out" of anything (that phrasing
	// belonged to the survivor-set rule this round replaced); its own
	// catalog name is simply not one a declaration can carry, the same
	// reason every sibling omission line states.
	it("import: names an omitted foreign key by its target's inexpressible name, not by claiming it was left out", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			omittedForeignKeys: [
				{
					schema: "app",
					table: "orders",
					name: "fk_widget",
					targetKind: "table",
					target: "app.Widgets",
				},
			],
		});

		const line = report.find((entry) =>
			entry.includes('foreign key "app.orders.fk_widget"'),
		);
		expect(line).toBeDefined();
		expect(line).toContain('references table "app.Widgets"');
		expect(line).toContain(
			"whose catalog name is not a valid hejbro SQL identifier, so no declaration can carry it",
		);
		expect(line).not.toContain("which this reading left out");
		expect(line).toContain("rename the table in the database");
	});

	it("pull: names an omitted foreign key by its target's inexpressible name, not by claiming it was left out", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			omittedForeignKeys: [
				{
					schema: "app",
					table: "orders",
					name: "fk_owner",
					targetKind: "schema",
					target: "App",
				},
			],
		});

		const line = report.find((entry) =>
			entry.includes('foreign key "app.orders.fk_owner"'),
		);
		expect(line).toBeDefined();
		expect(line).toContain('references schema "App"');
		expect(line).toContain(
			"whose catalog name is not a valid hejbro SQL identifier, so no declaration can carry it",
		);
		expect(line).not.toContain("which this reading left out");
		expect(line).toContain("Rename the schema in the database");
	});

	it("names an omitted index, its table, and says hejbro will not mention it again -- the same line for both commands, since a contract never carries indexes", () => {
		const facts = {
			omittedIndexes: [
				{ schema: "app", table: "widgets", sqlName: "IX_Widgets" },
			],
		};
		const importLine = buildLossReport({
			...emptyFacts("import"),
			...facts,
		}).find((entry) => entry.includes("IX_Widgets"));
		const pullLine = buildLossReport({ ...emptyFacts("pull"), ...facts }).find(
			(entry) => entry.includes("IX_Widgets"),
		);
		expect(importLine).toBeDefined();
		expect(importLine).toBe(pullLine);
		expect(importLine).toContain('index "app.widgets.IX_Widgets"');
		expect(importLine).toContain("hejbro will not mention it again");
	});

	it("names an omitted check constraint, its table, and says hejbro will not mention it again", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			omittedChecks: [
				{ schema: "app", table: "widgets", sqlName: "CK_Widgets" },
			],
		});

		const line = report.find((entry) => entry.includes("CK_Widgets"));
		expect(line).toBeDefined();
		expect(line).toContain('check constraint "app.widgets.CK_Widgets"');
		expect(line).toContain("hejbro will not mention it again");
	});

	// D106 R4-B3: the three "no ongoing check signal" wordings must be
	// distinct sentences, one per fact this round actually measured
	// (`check()` has no derived-name path; a whole omitted schema has
	// nothing left to anchor an inventory scan on; an omitted index or
	// check is never scanned for at all) -- never a single generic
	// "check will not report this" line reused three times.
	it("uses three distinct consequence sentences for a schema, an unanchored table, and an index/check omission -- never one generic line", () => {
		const schemaLine = buildLossReport({
			...emptyFacts("import"),
			omittedSchemas: [{ sqlName: "App" }],
		}).find((entry) => entry.includes('schema "App"'));
		const unanchoredTableLine = buildLossReport({
			...emptyFacts("import"),
			omittedTables: [
				{ schema: "app", sqlName: "Widgets", stillReportedInInventory: false },
			],
		}).find((entry) => entry.includes('table "app.Widgets"'));
		const indexLine = buildLossReport({
			...emptyFacts("import"),
			omittedIndexes: [
				{ schema: "app", table: "widgets", sqlName: "IX_Widgets" },
			],
		}).find((entry) => entry.includes("IX_Widgets"));

		expect(schemaLine).toContain("will not list them");
		expect(unanchoredTableLine).toContain(
			"only thing that schema would have declared",
		);
		expect(indexLine).toContain("hejbro will not mention it again");

		const consequenceSentences = new Set([
			schemaLine,
			unanchoredTableLine,
			indexLine,
		]);
		expect(consequenceSentences.size).toBe(3);
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

		expect(
			detectUniqueIndexApproximations(catalog, new Set(["app.pairs"])),
		).toEqual([{ schema: "app", table: "pairs", name: "pairs_a_b_unique" }]);
	});

	// D106 R5-N2: this detector alone read raw, schema-filtered catalog
	// rows with no surviving-table filter, so a UNIQUE constraint on an
	// omitted table (an invalid name) still announced an approximation
	// for an object the very next report line said was never inferred.
	it("names nothing for a UNIQUE constraint on a table the reading omitted", () => {
		const catalog: Catalog = {
			schemas: [],
			tables: [],
			columns: [],
			constraints: [
				{
					schema: "app",
					table: "Widgets",
					name: "widgets_email_key",
					type: "u",
					columns: ["email"],
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

		expect(detectUniqueIndexApproximations(catalog, new Set())).toEqual([]);
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

describe("detectForeignKeyNameApproximations / D106 R3-B3", () => {
	it("names only the foreign key whose catalog name isn't a valid hejbro SQL identifier, not the one that already is", () => {
		const tables: ReadonlyArray<InferredTableFacts> = [
			{
				schema: { declarationKind: "schema", schemaName: "app" },
				tableName: "comments",
				columns: [],
				foreignKeys: [
					{
						name: "Comments_PostId_FK",
						sourceColumns: ["post_id"],
						targetSchema: "app",
						targetTable: "posts",
						targetColumns: [],
						onDelete: "a",
						onUpdate: "a",
					},
					{
						name: "comments_author_id_fk",
						sourceColumns: ["author_id"],
						targetSchema: "app",
						targetTable: "users",
						targetColumns: [],
						onDelete: "a",
						onUpdate: "a",
					},
				],
				checks: [],
				indexes: [],
			},
		];

		expect(detectForeignKeyNameApproximations(tables)).toEqual([
			{
				schema: "app",
				table: "comments",
				catalogName: "Comments_PostId_FK",
				derivedName: "comments_post_id_fk",
			},
		]);
	});
});
