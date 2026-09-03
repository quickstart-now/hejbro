import { schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import {
	isNameDeclarable,
	partitionForeignKeys,
	partitionSchemas,
	partitionTables,
	withInventorySignal,
} from "../src/infer/compose";
import type {
	InferredForeignKey,
	InferredTableFacts,
} from "../src/infer/table";

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

// D106 R4-B1: a schema whose own catalog name `declareSchema` cannot
// express (D36) is excluded before it -- and everything it holds --
// ever reaches a declaration, but a sibling schema whose name is
// expressible is untouched.
describe("partitionSchemas / D106 R4-B1", () => {
	it("keeps a schema whose catalog name is a valid hejbro SQL identifier", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "app" }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual(["app"]);
		expect(result.omittedSchemas).toEqual([]);
	});

	it("omits a schema whose catalog name is not a valid hejbro SQL identifier, naming it", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "App" }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual([]);
		expect(result.omittedSchemas).toEqual([{ sqlName: "App" }]);
	});

	it("omits only the inexpressible schema, keeping its expressible sibling (a bad name costs that schema, not the reading)", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "app" }, { schema: "App" }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual(["app"]);
		expect(result.omittedSchemas).toEqual([{ sqlName: "App" }]);
	});
});

const app = schema("app");

const tableFacts = (
	tableName: string,
	foreignKeys: ReadonlyArray<InferredForeignKey> = [],
): InferredTableFacts => ({
	schema: app,
	tableName,
	columns: [],
	foreignKeys,
	checks: [],
	indexes: [],
});

/** A minimal inbound foreign key -- D106 R5-B1's own unit tests need one, and `tableFacts`'s own default (`foreignKeys: []`) never produced one before this round. */
const foreignKeyTo = (
	targetSchema: string,
	targetTable: string,
	name = "fk",
): InferredForeignKey => ({
	name,
	sourceColumns: ["target_id"],
	targetSchema,
	targetTable,
	targetColumns: [
		{
			sqlName: "id",
			facts: {
				schema: targetSchema,
				table: targetTable,
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
			},
		},
	],
	onDelete: "a",
	onUpdate: "a",
});

// D106 R4-B1: a table whose own catalog name `table()` cannot express
// is excluded -- with everything it holds -- but a sibling table whose
// name is expressible is untouched.
describe("partitionTables / D106 R4-B1", () => {
	it("keeps a table whose catalog name is a valid hejbro SQL identifier", () => {
		const result = partitionTables([tableFacts("widgets")]);
		expect(result.tables).toEqual([tableFacts("widgets")]);
		expect(result.omittedTables).toEqual([]);
	});

	it("omits a table whose catalog name is not a valid hejbro SQL identifier, naming it with its schema", () => {
		const result = partitionTables([tableFacts("Widgets")]);
		expect(result.tables).toEqual([]);
		expect(result.omittedTables).toEqual([
			{ schema: "app", sqlName: "Widgets" },
		]);
	});

	it("omits only the inexpressible table, keeping its expressible sibling (a bad name costs that table, not the reading)", () => {
		const result = partitionTables([
			tableFacts("widgets"),
			tableFacts("Widgets"),
		]);
		expect(result.tables).toEqual([tableFacts("widgets")]);
		expect(result.omittedTables).toEqual([
			{ schema: "app", sqlName: "Widgets" },
		]);
	});
});

// D106 R4-B3/#707: `check`'s own inventory needs another declared table
// or enum in the same schema to scan it at all -- mirrors
// `check/inventory.ts`'s own `declaredSchemaNames` rule (not imported;
// that module reads a built `Snapshot`, this reading has only the
// pre-snapshot facts at this point).
describe("withInventorySignal / D106 R4-B3", () => {
	it("marks an omitted table as still reported when its schema holds another declared table", () => {
		const result = withInventorySignal(
			[{ schema: "app", sqlName: "Widgets" }],
			new Set(["app"]),
		);
		expect(result).toEqual([
			{ schema: "app", sqlName: "Widgets", stillReportedInInventory: true },
		]);
	});

	it("marks an omitted table as never reported when its schema holds no other declaration", () => {
		const result = withInventorySignal(
			[{ schema: "app", sqlName: "Widgets" }],
			new Set(),
		);
		expect(result).toEqual([
			{ schema: "app", sqlName: "Widgets", stillReportedInInventory: false },
		]);
	});
});

// D106 R5-B2: round-trippable alone is not enough -- a name can round-
// trip and still fail D36 (`table()`'s own `assertSqlName`), and only
// one predicate should ever answer "can this be declared".
describe("isNameDeclarable / D106 R5-B2", () => {
	it("accepts an ordinary column whose key round-trips to a D36 name", () => {
		expect(isNameDeclarable("id", "id")).toBe(true);
	});

	it("rejects a leading-underscore name even though it is its own round-trip fixed point", () => {
		// toSnakeCase("_id") === "_id" (the round trip holds), but
		// assertSqlName's own pattern (^[a-z][a-z0-9_]*$) starts with
		// a-z, not _ -- the exact gap D106 R5-B2 measured live.
		expect(isNameDeclarable("_id", "_id")).toBe(false);
	});

	it("rejects a name whose key does not round-trip at all (the pre-existing case)", () => {
		expect(isNameDeclarable("createdAt", "createdAt")).toBe(false);
	});
});

// D106 R6-B1: a foreign key is omitted for exactly the reason every
// other object in this module is -- its *target*'s own name is one a
// declaration cannot carry. Whether the target's schema was ever named
// on `--schema` is a different question this function no longer asks:
// a target this run simply never read keeps its foreign key (declared
// against an `existingTable` handle, `declare-emit/emit.ts`'s own
// concern), it is never omitted here.
describe("partitionForeignKeys / D106 R6-B1", () => {
	it("keeps a foreign key whose target table survived", () => {
		const orders = tableFacts("orders", [foreignKeyTo("app", "widgets")]);
		const widgets = tableFacts("widgets");
		const result = partitionForeignKeys([orders, widgets]);

		expect(result.omittedForeignKeys).toEqual([]);
		expect(
			result.tables.find((table) => table.tableName === "orders")?.foreignKeys,
		).toHaveLength(1);
	});

	it("keeps a foreign key into a table in a schema the run did not name", () => {
		// `ext.users` is not one of `tables` at all -- this run never read
		// schema "ext" -- and both names are perfectly ordinary lower
		// snake_case, so nothing about them is inexpressible.
		const orders = tableFacts("orders", [
			foreignKeyTo("ext", "users", "fk_owner"),
		]);
		const result = partitionForeignKeys([orders]);

		expect(result.omittedForeignKeys).toEqual([]);
		expect(result.tables[0]?.foreignKeys).toEqual([
			foreignKeyTo("ext", "users", "fk_owner"),
		]);
	});

	it("omits a foreign key whose target table was itself omitted, naming the target as a table", () => {
		const orders = tableFacts("orders", [
			foreignKeyTo("app", "Widgets", "fk_widget"),
		]);
		const result = partitionForeignKeys([orders]);

		expect(result.omittedForeignKeys).toEqual([
			{
				schema: "app",
				table: "orders",
				name: "fk_widget",
				targetKind: "table",
				target: "app.Widgets",
			},
		]);
		expect(result.tables[0]?.foreignKeys).toEqual([]);
	});

	it("omits a foreign key whose target schema was itself omitted, naming the target as a schema", () => {
		const orders = tableFacts("orders", [
			foreignKeyTo("App", "orders", "fk_owner"),
		]);
		const result = partitionForeignKeys([orders]);

		expect(result.omittedForeignKeys).toEqual([
			{
				schema: "app",
				table: "orders",
				name: "fk_owner",
				targetKind: "schema",
				target: "App",
			},
		]);
		expect(result.tables[0]?.foreignKeys).toEqual([]);
	});

	it("keeps a self-referencing foreign key", () => {
		const widgets = tableFacts("widgets", [
			foreignKeyTo("app", "widgets", "fk_parent"),
		]);
		const result = partitionForeignKeys([widgets]);

		expect(result.omittedForeignKeys).toEqual([]);
		expect(result.tables[0]?.foreignKeys).toHaveLength(1);
	});
});
