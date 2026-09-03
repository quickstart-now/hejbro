import { emptySnapshot, generateMigration, schema } from "@hejbro/core";
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

		const tables = mergeTableFacts(
			catalog,
			inferenceCatalog,
			new Map(),
			(name) => schema(name),
		);
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

	/**
	 * D106 N3: byte-identity across two readings of the same, unchanged
	 * database rests on Postgres returning catalog rows in the same order
	 * twice, which nothing guaranteed before this -- `foreignKeysFor`/
	 * `checksFor`/`indexesFor` (`infer/adapter.ts`) now sort explicitly by
	 * name rather than trusting row order to survive. Two tables' own
	 * multiple checks/FKs/indexes, fed in forward and reversed row order,
	 * must merge into identically-ordered arrays either way.
	 */
	it("orders a table's own checks, foreign keys and indexes by name, regardless of the catalog row order they arrived in", () => {
		const baseCatalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "targets", rls: false },
				{ schema: "app", table: "widgets", rls: false },
			],
			columns: [
				{
					schema: "app",
					table: "targets",
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
					table: "widgets",
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
					table: "widgets",
					name: "a_ref",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "b_ref",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "amount",
					notNull: true,
					catalogType: "integer",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "int4",
					catalogDefault: null,
				},
			],
			constraints: [
				{
					schema: "app",
					table: "widgets",
					name: "widgets_z_fkey",
					type: "f",
					columns: ["b_ref"],
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_a_fkey",
					type: "f",
					columns: ["a_ref"],
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_z_check",
					type: "c",
					columns: ["amount"],
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_a_check",
					type: "c",
					columns: ["amount"],
				},
			],
			indexes: [
				{ schema: "app", table: "widgets", name: "widgets_z_idx" },
				{ schema: "app", table: "widgets", name: "widgets_a_idx" },
			],
		};
		const baseInferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			columnDetails: [
				{
					schema: "app",
					table: "targets",
					name: "id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "a_ref",
					position: 2,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "b_ref",
					position: 3,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "amount",
					position: 4,
					identityKind: "",
					generatedKind: "",
				},
			],
			foreignKeyDetails: [
				{
					schema: "app",
					table: "widgets",
					name: "widgets_z_fkey",
					targetSchema: "app",
					targetTable: "targets",
					targetColumns: ["id"],
					onDelete: "a",
					onUpdate: "a",
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_a_fkey",
					targetSchema: "app",
					targetTable: "targets",
					targetColumns: ["id"],
					onDelete: "a",
					onUpdate: "a",
				},
			],
			checkExpressions: [
				{
					schema: "app",
					table: "widgets",
					name: "widgets_z_check",
					expression: "(amount > 0)",
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_a_check",
					expression: "(amount < 100)",
				},
			],
			indexDetails: [
				{
					schema: "app",
					table: "widgets",
					name: "widgets_z_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "amount",
							text: "amount",
							opclass: "int4_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
				{
					schema: "app",
					table: "widgets",
					name: "widgets_a_idx",
					isUnique: false,
					method: "btree",
					predicate: null,
					columns: [
						{
							column: "amount",
							text: "amount",
							opclass: "int4_ops",
							opclassIsDefault: true,
							descending: false,
							nullsFirst: false,
						},
					],
				},
			],
		};

		const widgetsFactsFrom = (
			catalog: Catalog,
			inferenceCatalog: InferenceCatalog,
		) => {
			const tables = mergeTableFacts(
				catalog,
				inferenceCatalog,
				new Map(),
				(name) => schema(name),
			);
			const widgets = tables.find((t) => t.tableName === "widgets");
			if (widgets === undefined) {
				throw new Error("expected widgets table facts");
			}
			return widgets;
		};

		const forward = widgetsFactsFrom(baseCatalog, baseInferenceCatalog);
		const reversed = widgetsFactsFrom(
			{ ...baseCatalog, constraints: [...baseCatalog.constraints].reverse() },
			{
				...baseInferenceCatalog,
				indexDetails: [...baseInferenceCatalog.indexDetails].reverse(),
			},
		);

		// widgets_a_fkey (source a_ref) sorts before widgets_z_fkey (source
		// b_ref) by constraint name -- sourceColumns is what tells the two
		// foreign keys apart here (both target the same column of `targets`).
		expect(forward.foreignKeys.map((fk) => fk.sourceColumns)).toEqual([
			["a_ref"],
			["b_ref"],
		]);
		expect(forward.foreignKeys.map((fk) => fk.sourceColumns)).toEqual(
			reversed.foreignKeys.map((fk) => fk.sourceColumns),
		);
		expect(forward.checks).toEqual([
			{ name: "widgets_a_check", expression: "(amount < 100)" },
			{ name: "widgets_z_check", expression: "(amount > 0)" },
		]);
		expect(forward.checks).toEqual(reversed.checks);
		expect(forward.indexes.map((idx) => idx.name)).toEqual([
			"widgets_a_idx",
			"widgets_z_idx",
		]);
		expect(forward.indexes.map((idx) => idx.name)).toEqual(
			reversed.indexes.map((idx) => idx.name),
		);
	});
});
