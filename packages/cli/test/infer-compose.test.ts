import { schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import {
	partitionSchemas,
	partitionTables,
	withInventorySignal,
} from "../src/infer/compose";
import type { InferredTableFacts } from "../src/infer/table";

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

const tableFacts = (tableName: string): InferredTableFacts => ({
	schema: app,
	tableName,
	columns: [],
	foreignKeys: [],
	checks: [],
	indexes: [],
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
