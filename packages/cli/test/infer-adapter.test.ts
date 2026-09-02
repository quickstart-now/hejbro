import { emptySnapshot, generateMigration } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import { mergeTableFacts } from "../src/infer/adapter";
import type { InferenceCatalog } from "../src/infer/catalog";
import { inferTable } from "../src/infer/table";

const emptyCatalog = (): Catalog => ({
	schemas: [{ schema: "app" }],
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

const emptyInferenceCatalog = (): InferenceCatalog => ({
	columnDetails: [],
	foreignKeyDetails: [],
	checkExpressions: [],
	indexDetails: [],
	enumLabels: [],
	sequenceOwnership: [],
});

describe("mergeTableFacts / 1.4b adapter", () => {
	it("assembles a table's own columns, primary key, foreign key, check and index from raw catalog rows", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "parents", rls: false },
				{ schema: "app", table: "children", rls: false },
			],
			columns: [
				{
					schema: "app",
					table: "parents",
					name: "id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "children",
					name: "id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "children",
					name: "parent_id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "children",
					name: "name",
					notNull: true,
					catalogType: "text",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "text",
					catalogDefault: null,
				},
			],
			constraints: [
				{
					schema: "app",
					table: "parents",
					name: "parents_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "children",
					name: "children_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "children",
					name: "children_parent_id_fkey",
					type: "f",
					columns: ["parent_id"],
				},
				{
					schema: "app",
					table: "children",
					name: "children_name_check",
					type: "c",
					columns: ["name"],
				},
			],
			indexes: [
				{ schema: "app", table: "parents", name: "parents_pkey" },
				{ schema: "app", table: "children", name: "children_pkey" },
				{ schema: "app", table: "children", name: "children_name_idx" },
			],
		};
		const inferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			columnDetails: [
				{
					schema: "app",
					table: "parents",
					name: "id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "children",
					name: "id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "children",
					name: "parent_id",
					position: 2,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "children",
					name: "name",
					position: 3,
					identityKind: "",
					generatedKind: "",
				},
			],
			foreignKeyDetails: [
				{
					schema: "app",
					table: "children",
					name: "children_parent_id_fkey",
					targetSchema: "app",
					targetTable: "parents",
					targetColumns: ["id"],
					onDelete: "c",
					onUpdate: "a",
				},
			],
			checkExpressions: [
				{
					schema: "app",
					table: "children",
					name: "children_name_check",
					expression: "(length(name) > 0)",
				},
			],
			indexDetails: [
				// Backs the primary key -- must not surface as a separate index
				// (1.4 already declares the PK via .primaryKey()).
				{
					schema: "app",
					table: "parents",
					name: "parents_pkey",
					isUnique: true,
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
				{
					schema: "app",
					table: "children",
					name: "children_pkey",
					isUnique: true,
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
				{
					schema: "app",
					table: "children",
					name: "children_name_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "name",
							text: "name",
							opclass: "text_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		};

		const tables = mergeTableFacts(catalog, inferenceCatalog, new Map());
		expect(tables).toHaveLength(2);

		const childrenFacts = tables.find((t) => t.tableName === "children");
		if (childrenFacts === undefined) {
			throw new Error("expected children table facts");
		}
		expect(childrenFacts.columns.map((c) => c.sqlName).sort()).toEqual([
			"id",
			"name",
			"parent_id",
		]);
		const idColumn = childrenFacts.columns.find((c) => c.sqlName === "id");
		expect(idColumn?.isPrimaryKey).toBe(true);
		expect(childrenFacts.foreignKeys).toHaveLength(1);
		expect(childrenFacts.foreignKeys[0]?.targetTable).toBe("parents");
		expect(childrenFacts.checks).toEqual([
			{ name: "children_name_check", expression: "(length(name) > 0)" },
		]);
		// The PK-backing index is excluded; only the genuinely separate one remains.
		expect(childrenFacts.indexes.map((i) => i.name)).toEqual([
			"children_name_idx",
		]);

		const parentsFacts = tables.find((t) => t.tableName === "parents");
		if (parentsFacts === undefined) {
			throw new Error("expected parents table facts");
		}
		expect(parentsFacts.indexes).toEqual([]);

		const parents = inferTable(parentsFacts);
		const children = inferTable(childrenFacts);
		expect(parents.losses).toEqual([]);
		expect(children.losses).toEqual([]);
		const migration = generateMigration({
			declarations: [
				...tables.map((t) => t.schema).slice(0, 1),
				parents.table,
				children.table,
			],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);
		expect(migration.sql).toContain(
			'foreign key ("parent_id") references "app"."parents" ("id") on delete cascade',
		);
	});
});
