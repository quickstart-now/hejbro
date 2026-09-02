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
	selfForeignKeys: [],
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
			selfForeignKeys: [
				{
					sourceColumns: ["parent_id"],
					targetColumns: ["id"],
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
