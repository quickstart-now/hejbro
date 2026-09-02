import { emptySnapshot, generateMigration, schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { InferredColumnFacts } from "../src/infer/columns";
import type { InferredTableFacts } from "../src/infer/table";
import { inferTable } from "../src/infer/table";

const app = schema("app");

const columnFacts = (
	overrides: Partial<InferredColumnFacts> = {},
): InferredColumnFacts => ({
	schema: "app",
	table: "widgets",
	name: "id",
	sqlType: "uuid",
	baseTypeName: "uuid",
	isArray: false,
	notNull: true,
	catalogDefault: null,
	identityKind: "",
	generatedKind: "",
	identityOptions: null,
	isSerialOwned: false,
	enumDeclaration: null,
	...overrides,
});

const emptyTableFacts: InferredTableFacts = {
	schema: app,
	tableName: "widgets",
	columns: [
		{
			sqlName: "id",
			tsKey: "id",
			facts: columnFacts(),
			isPrimaryKey: true,
		},
	],
	foreignKeys: [],
	checks: [],
	indexes: [],
};

const buildSql = (facts: InferredTableFacts): string => {
	const result = inferTable(facts);
	expect(result.losses).toEqual([]);
	const migration = generateMigration({
		declarations: [app, result.table],
		previousSnapshot: emptySnapshot,
	});
	expect(migration.errors).toEqual([]);
	return migration.sql;
};

describe("inferTable / 1.4 primary key", () => {
	it("marks the primary key column(s) with .primaryKey()", () => {
		const sql = buildSql(emptyTableFacts);
		expect(sql).toContain('primary key ("id")');
	});
});

describe("inferTable / 1.4 checks", () => {
	it("declares a check constraint from its raw expression via sql.raw", () => {
		const facts: InferredTableFacts = {
			...emptyTableFacts,
			columns: [
				emptyTableFacts.columns[0] as InferredTableFacts["columns"][number],
				{
					sqlName: "name",
					tsKey: "name",
					facts: columnFacts({
						name: "name",
						sqlType: "text",
						baseTypeName: "text",
						notNull: true,
					}),
					isPrimaryKey: false,
				},
			],
			checks: [
				{ name: "widgets_name_not_blank", expression: "(length(name) > 0)" },
			],
		};

		const sql = buildSql(facts);
		expect(sql).toContain(
			'constraint "widgets_name_not_blank" check ((length(name) > 0))',
		);
	});
});

describe("inferTable / 1.4 self-referencing foreign key", () => {
	it("declares a self-referencing foreign key with its onDelete action", () => {
		const facts: InferredTableFacts = {
			...emptyTableFacts,
			columns: [
				emptyTableFacts.columns[0] as InferredTableFacts["columns"][number],
				{
					sqlName: "parent_id",
					tsKey: "parentId",
					facts: columnFacts({
						name: "parent_id",
						notNull: false,
					}),
					isPrimaryKey: false,
				},
			],
			foreignKeys: [
				{
					name: "widgets_parent_id_fk",
					sourceColumns: ["parent_id"],
					targetSchema: "app",
					targetTable: "widgets",
					targetColumns: [{ sqlName: "id", facts: columnFacts() }],
					onDelete: "c",
					onUpdate: "a",
				},
			],
		};

		const sql = buildSql(facts);
		expect(sql).toContain(
			'foreign key ("parent_id") references "app"."widgets" ("id") on delete cascade',
		);
		// onUpdate = 'a' (no action, Postgres's own default) -- never rendered.
		expect(sql).not.toContain("on update");
	});
});

// D106 R3-B3: a foreign key's own catalog name, preserved when it round-trips
// through the DSL's own D36 rule, approximated (falls back to deriving) when
// it doesn't.
describe("inferTable / 1.4 foreign key names (D106 R3-B3)", () => {
	const facts = (name: string): InferredTableFacts => ({
		...emptyTableFacts,
		columns: [
			emptyTableFacts.columns[0] as InferredTableFacts["columns"][number],
			{
				sqlName: "parent_id",
				tsKey: "parentId",
				facts: columnFacts({ name: "parent_id", notNull: false }),
				isPrimaryKey: false,
			},
		],
		foreignKeys: [
			{
				name,
				sourceColumns: ["parent_id"],
				targetSchema: "app",
				targetTable: "widgets",
				targetColumns: [{ sqlName: "id", facts: columnFacts() }],
				onDelete: "a",
				onUpdate: "a",
			},
		],
	});

	it("carries the catalog's own name into the generated constraint when it differs from the derived one and is a valid hejbro identifier", () => {
		const sql = buildSql(facts("widgets_parent_id_fkey"));
		expect(sql).toContain(
			'add constraint "widgets_parent_id_fkey" foreign key',
		);
	});

	it("falls back to the derived name, with no loss reported here (that is loss-report.ts's own job), when the catalog name is not a valid hejbro identifier", () => {
		const result = inferTable(facts("Not-A-Valid-Name"));
		expect(result.losses).toEqual([]);
		const migration = generateMigration({
			declarations: [app, result.table],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);
		expect(migration.sql).toContain(
			'add constraint "widgets_parent_id_fk" foreign key',
		);
		expect(migration.sql).not.toContain("Not-A-Valid-Name");
	});
});

describe("inferTable / 1.4 indexes -- the five shapes", () => {
	const plainColumnIndex = () =>
		buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		});

	it("plain column index", () => {
		expect(plainColumnIndex()).toContain(
			'create index "widgets_id_idx" on "app"."widgets" ("id")',
		);
	});

	it("expression column index (sql.raw, never a plain column ref)", () => {
		const sql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_lower_id_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: null,
							text: "lower(id::text)",
							opclass: "text_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		});
		expect(sql).toContain(
			'create index "widgets_lower_id_idx" on "app"."widgets" ((lower(id::text)))',
		);
	});

	it("partial predicate", () => {
		const sql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_partial_idx",
					isUnique: true,
					method: "btree",
					predicate: "(id IS NOT NULL)",
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		});
		expect(sql).toContain("where (id IS NOT NULL)");
		expect(sql).toContain('unique index "widgets_id_partial_idx"');
	});

	it("non-btree access method, only when it differs from the default", () => {
		const sql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_gin_idx",
					isUnique: false,
					method: "gin",
					predicate: null,
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		});
		expect(sql).toContain("using gin");
	});

	it("a non-default operator class, but never the default one", () => {
		const nonDefaultSql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_opclass_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: false,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		});
		expect(nonDefaultSql).toContain("uuid_ops");

		const defaultSql = plainColumnIndex();
		expect(defaultSql).not.toContain("uuid_ops");
	});

	it("declares a plain descending column with no explicit nulls placement (DESC's own default is nulls-first)", () => {
		const sql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_desc_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: true,
							descending: true,
							nullsFirst: true,
						},
					],
				},
			],
		});
		expect(sql).toContain('"id" desc)');
		expect(sql).not.toContain("nulls");

		// Ascending + nulls-last is Postgres's own default for every plain
		// (non-desc) column -- never rendered as an explicit "asc nulls last".
		const plain = plainColumnIndex();
		expect(plain).not.toContain("asc");
		expect(plain).not.toContain("nulls");
	});

	it("declares an explicit nulls placement only when it disagrees with the direction's own default", () => {
		// DESC's own Postgres default is nulls-first (pinned by the test
		// above) -- nullsFirst: false here is the *non*-default combination,
		// the only one that must render an explicit "nulls last".
		const sql = buildSql({
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_desc_nulls_last_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "id",
							text: "id",
							opclass: "uuid_ops",
							opclassIsDefault: true,
							descending: true,
							nullsFirst: false,
						},
					],
				},
			],
		});
		expect(sql).toContain('"id" desc nulls last');
	});
});

describe("inferTable / 1.4b non-self foreign keys (existingTable, D41)", () => {
	it("declares a foreign key to another already-inferred table, without needing it built first", () => {
		const parentsFacts: InferredTableFacts = {
			schema: app,
			tableName: "parents",
			columns: [
				{
					sqlName: "id",
					tsKey: "id",
					facts: columnFacts(),
					isPrimaryKey: true,
				},
			],
			foreignKeys: [],
			checks: [],
			indexes: [],
		};
		const childrenFacts: InferredTableFacts = {
			schema: app,
			tableName: "children",
			columns: [
				{
					sqlName: "id",
					tsKey: "id",
					facts: columnFacts(),
					isPrimaryKey: true,
				},
				{
					sqlName: "parent_id",
					tsKey: "parentId",
					facts: columnFacts({ name: "parent_id", notNull: true }),
					isPrimaryKey: false,
				},
			],
			foreignKeys: [
				{
					name: "children_parent_id_fk",
					sourceColumns: ["parent_id"],
					targetSchema: "app",
					targetTable: "parents",
					targetColumns: [{ sqlName: "id", facts: columnFacts() }],
					onDelete: "c",
					onUpdate: "a",
				},
			],
			checks: [],
			indexes: [],
		};

		const parents = inferTable(parentsFacts);
		const children = inferTable(childrenFacts);
		expect(parents.losses).toEqual([]);
		expect(children.losses).toEqual([]);
		const migration = generateMigration({
			declarations: [app, parents.table, children.table],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);

		expect(migration.sql).toContain(
			'foreign key ("parent_id") references "app"."parents" ("id") on delete cascade',
		);
		// The existingTable handle built only to resolve the reference must
		// never itself surface as a table -- exactly the two real ones.
		const tableKeys = Object.keys(migration.snapshot.objects).filter((key) =>
			key.startsWith("table:"),
		);
		expect(tableKeys.sort()).toEqual([
			"table:app.children",
			"table:app.parents",
		]);

		const childrenSnapshot = migration.snapshot.objects[
			"table:app.children"
		] as {
			readonly foreignKeys: ReadonlyArray<{ readonly referencesTable: string }>;
		};
		expect(childrenSnapshot.foreignKeys).toHaveLength(1);
		expect(childrenSnapshot.foreignKeys[0]?.referencesTable).toBe(
			"app.parents",
		);
	});

	it("declares a two-table cycle (A references B, B references A) with no build-order dependency", () => {
		const aFacts: InferredTableFacts = {
			schema: app,
			tableName: "table_a",
			columns: [
				{
					sqlName: "id",
					tsKey: "id",
					facts: columnFacts(),
					isPrimaryKey: true,
				},
				{
					sqlName: "b_id",
					tsKey: "bId",
					facts: columnFacts({ name: "b_id", notNull: false }),
					isPrimaryKey: false,
				},
			],
			foreignKeys: [
				{
					name: "table_a_b_id_fk",
					sourceColumns: ["b_id"],
					targetSchema: "app",
					targetTable: "table_b",
					targetColumns: [{ sqlName: "id", facts: columnFacts() }],
					onDelete: "a",
					onUpdate: "a",
				},
			],
			checks: [],
			indexes: [],
		};
		const bFacts: InferredTableFacts = {
			schema: app,
			tableName: "table_b",
			columns: [
				{
					sqlName: "id",
					tsKey: "id",
					facts: columnFacts(),
					isPrimaryKey: true,
				},
				{
					sqlName: "a_id",
					tsKey: "aId",
					facts: columnFacts({ name: "a_id", notNull: false }),
					isPrimaryKey: false,
				},
			],
			foreignKeys: [
				{
					name: "table_b_a_id_fk",
					sourceColumns: ["a_id"],
					targetSchema: "app",
					targetTable: "table_a",
					targetColumns: [{ sqlName: "id", facts: columnFacts() }],
					onDelete: "a",
					onUpdate: "a",
				},
			],
			checks: [],
			indexes: [],
		};

		// Built in either order -- neither is the other's real object yet,
		// and neither ever needs to be (D41's whole point).
		const a = inferTable(aFacts);
		const b = inferTable(bFacts);
		const migration = generateMigration({
			declarations: [app, a.table, b.table],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);

		const tableKeys = Object.keys(migration.snapshot.objects).filter((key) =>
			key.startsWith("table:"),
		);
		expect(tableKeys.sort()).toEqual([
			"table:app.table_a",
			"table:app.table_b",
		]);
		expect(migration.sql).toContain(
			'foreign key ("b_id") references "app"."table_b" ("id")',
		);
		expect(migration.sql).toContain(
			'foreign key ("a_id") references "app"."table_a" ("id")',
		);
	});
});

// D106 R4-B1: a check or index whose catalog name Postgres allowed but
// hejbro cannot express (D36) costs that one object, never the table --
// unlike a table/schema name (compose.ts's own `partitionTables`/
// `partitionSchemas`), a check/index lives inside an already-valid
// table, so omitting it here is enough; nothing upstream needs to know.
describe("inferTable / 1.4 check and index name omission (D106 R4-B1)", () => {
	it("omits a check constraint whose catalog name is not a valid hejbro SQL identifier, keeping the table and its other checks", () => {
		const facts: InferredTableFacts = {
			...emptyTableFacts,
			checks: [
				{ name: "widgets_name_not_blank", expression: "(length(name) > 0)" },
				{ name: "CK_Widgets", expression: "(true)" },
			],
		};

		const result = inferTable(facts);
		expect(result.omittedChecks).toEqual([
			{ schema: "app", table: "widgets", sqlName: "CK_Widgets" },
		]);
		expect(result.losses).toEqual([]);

		const migration = generateMigration({
			declarations: [app, result.table],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);
		expect(migration.sql).toContain('constraint "widgets_name_not_blank"');
		expect(migration.sql).not.toContain("CK_Widgets");
	});

	it("omits an index whose catalog name is not a valid hejbro SQL identifier, keeping the table and its other indexes", () => {
		const indexColumn = {
			column: "id",
			text: "id",
			opclass: "uuid_ops",
			opclassIsDefault: true,
			descending: false,
			nullsFirst: false,
		};
		const facts: InferredTableFacts = {
			...emptyTableFacts,
			indexes: [
				{
					name: "widgets_id_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [indexColumn],
				},
				{
					name: "IX_Widgets",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [indexColumn],
				},
			],
		};

		const result = inferTable(facts);
		expect(result.omittedIndexes).toEqual([
			{ schema: "app", table: "widgets", sqlName: "IX_Widgets" },
		]);
		expect(result.losses).toEqual([]);

		const migration = generateMigration({
			declarations: [app, result.table],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);
		expect(migration.sql).toContain('"widgets_id_idx"');
		expect(migration.sql).not.toContain("IX_Widgets");
	});

	it("reports no omission for a table whose checks and indexes are all expressible", () => {
		const result = inferTable(emptyTableFacts);
		expect(result.omittedChecks).toEqual([]);
		expect(result.omittedIndexes).toEqual([]);
	});
});
