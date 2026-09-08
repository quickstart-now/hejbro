import { schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { ColumnOmissionCause } from "../src/infer/compose";
import {
	partitionForeignKeys,
	partitionSchemas,
	partitionTables,
	withInventorySignal,
} from "../src/infer/compose";
import type {
	InferredForeignKey,
	InferredTableFacts,
} from "../src/infer/table";
import { isNameDeclarable } from "../src/infer/table";

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

	it("omits a schema whose catalog name is not a valid hejbro SQL identifier and that lost a table to it, naming it", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "App" }],
			tables: [{ schema: "App", table: "t", rls: false }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual([]);
		expect(result.omittedSchemas).toEqual([{ sqlName: "App" }]);
	});

	it("omits only the inexpressible schema, keeping its expressible sibling (a bad name costs that schema, not the reading)", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "app" }, { schema: "App" }],
			tables: [{ schema: "App", table: "t", rls: false }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual(["app"]);
		expect(result.omittedSchemas).toEqual([{ sqlName: "App" }]);
	});
});

/**
 * 712/R17 (D106 round 2 constructor review, B2, lead ruling, extended):
 * an inexpressibly-named schema's own name failing D36 is never enough
 * on its own to earn it an `Omitted: schema …` line -- only losing a
 * table or enum to that name does; a schema that lost nothing (D36
 * failed but it held no table or enum) belongs to *neither*
 * `expressibleNames` nor `omittedSchemas` (a third, silent case --
 * `declareSchema` would still refuse its name, so it is never passed
 * there either). Input as wide as the claim: an inexpressibly-named
 * schema holding nothing at all, one holding only a standalone
 * sequence, one holding only a function, one holding a table, and one
 * holding an enum -- the first three appear in neither list, the last
 * two appear in `omittedSchemas` alone.
 */
describe("partitionSchemas / 712/R17 (D106 round 2, B2): omittedSchemas only for a lost table or enum", () => {
	it.each<
		[string, Partial<Catalog>, ReadonlyArray<{ readonly sqlName: string }>]
	>([
		["nothing at all", {}, []],
		[
			"only a standalone sequence",
			{ sequences: [{ schema: "Bad", name: "s" }] },
			[],
		],
		["only a function", { functions: [{ schema: "Bad", name: "f" }] }, []],
		[
			"a table",
			{ tables: [{ schema: "Bad", table: "t", rls: false }] },
			[{ sqlName: "Bad" }],
		],
		[
			"an enum",
			{ enums: [{ schema: "Bad", name: "e" }] },
			[{ sqlName: "Bad" }],
		],
	])(
		"an inexpressibly-named schema holding %s",
		(_label, catalogOverrides, expected) => {
			const catalog: Catalog = {
				...emptyCatalog(),
				...catalogOverrides,
				schemas: [{ schema: "Bad" }],
			};
			const result = partitionSchemas(catalog);
			expect(result.expressibleNames).toEqual([]);
			expect(result.omittedSchemas).toEqual(expected);
		},
	);

	it("names only the inexpressibly-named schema holding a table, beside an inexpressibly-named sibling holding nothing -- neither list carries the empty one", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			schemas: [{ schema: "Bad" }, { schema: "AlsoBad" }],
			tables: [{ schema: "AlsoBad", table: "t", rls: false }],
		};
		const result = partitionSchemas(catalog);
		expect(result.expressibleNames).toEqual([]);
		expect(result.omittedSchemas).toEqual([{ sqlName: "AlsoBad" }]);
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

/** #873: none of this suite's fixtures carry an undeclarable-name column (`tableFacts`'s own default is always `columns: []`) -- `survivingTableIdentitiesFor` supplies `partitionForeignKeys`'s other new, required parameter with the same set `compose.ts` itself derives from its own tables list, and an empty omitted-column set is exactly right here (631/R8: the added parameter, nothing else). */
const survivingTableIdentitiesFor = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlySet<string> =>
	new Set(
		tables.map((table) => `${table.schema.schemaName}.${table.tableName}`),
	);

const noOmittedColumns: ReadonlyMap<string, ColumnOmissionCause> = new Map();

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
		const tables = [orders, widgets];
		const result = partitionForeignKeys(
			tables,
			survivingTableIdentitiesFor(tables),
			noOmittedColumns,
		);

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
		const result = partitionForeignKeys(
			[orders],
			survivingTableIdentitiesFor([orders]),
			noOmittedColumns,
		);

		expect(result.omittedForeignKeys).toEqual([]);
		expect(result.tables[0]?.foreignKeys).toEqual([
			foreignKeyTo("ext", "users", "fk_owner"),
		]);
	});

	it("omits a foreign key whose target table was itself omitted, naming the target as a table", () => {
		const orders = tableFacts("orders", [
			foreignKeyTo("app", "Widgets", "fk_widget"),
		]);
		const result = partitionForeignKeys(
			[orders],
			survivingTableIdentitiesFor([orders]),
			noOmittedColumns,
		);

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
		const result = partitionForeignKeys(
			[orders],
			survivingTableIdentitiesFor([orders]),
			noOmittedColumns,
		);

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
		const result = partitionForeignKeys(
			[widgets],
			survivingTableIdentitiesFor([widgets]),
			noOmittedColumns,
		);

		expect(result.omittedForeignKeys).toEqual([]);
		expect(result.tables[0]?.foreignKeys).toHaveLength(1);
	});
});

/** A foreign key naming a specific column at either end, target column facts minimal (identity only matters to `partitionForeignKeys`). */
const foreignKeyToColumn = (
	name: string,
	sourceColumns: ReadonlyArray<string>,
	targetSchema: string,
	targetTable: string,
	targetColumnName: string,
): InferredForeignKey => ({
	name,
	sourceColumns,
	targetSchema,
	targetTable,
	targetColumns: [
		{
			sqlName: targetColumnName,
			facts: {
				schema: targetSchema,
				table: targetTable,
				name: targetColumnName,
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

/**
 * 712/R16 (D106 round 2, R2-N1): `omissionEntryFor`'s own
 * `"generatedExpression"` branch mirrors `firstOffendingColumn`'s own
 * symmetric field (`rootNotInferredSqlTypeField`) -- before this, a
 * foreign-key end bound to a generated column whose own root cause was
 * `"notInferred"` lost `rootNotInferredSqlType` in transit, so
 * `loss-report.ts`'s `generatedExpressionRootClause` fell through to
 * its default (name-cause) branch. Input as wide as the claim: both
 * ends a foreign key can bind through a generated column, plus the
 * direct (no generated column) case as a regression control.
 */
describe("partitionForeignKeys / 712/R16 (D106 round 2, R2-N1): a generated-column end's own not-inferred root", () => {
	it("target end: a foreign key referencing a generated column whose root is a not-inferred type carries the root's own sqlType", () => {
		const genType = tableFacts("gen_type");
		const ref = tableFacts("gen_type_ref", [
			foreignKeyToColumn(
				"gen_type_ref_ref_fkey",
				["ref"],
				"app",
				"gen_type",
				"pt_txt",
			),
		]);
		const tables = [genType, ref];
		const causes: ReadonlyMap<string, ColumnOmissionCause> = new Map([
			[
				"app.gen_type.pt_txt",
				{
					cause: "generatedExpression",
					rootColumnIdentity: "app.gen_type.pt",
					rootCause: "notInferred",
					rootNotInferredSqlType: "point",
				},
			],
		]);

		const result = partitionForeignKeys(
			tables,
			survivingTableIdentitiesFor(tables),
			causes,
		);

		expect(result.omittedForeignKeysByColumn).toEqual([
			{
				schema: "app",
				table: "gen_type_ref",
				name: "gen_type_ref_ref_fkey",
				columnIdentity: "app.gen_type.pt_txt",
				end: "target",
				cause: "generatedExpression",
				rootColumnIdentity: "app.gen_type.pt",
				rootCause: "notInferred",
				rootNotInferredSqlType: "point",
			},
		]);
	});

	it("source end: a foreign key whose own source column is a generated column with a not-inferred root carries the root's own sqlType too", () => {
		const gen = tableFacts("t", [
			foreignKeyToColumn("t_pt_txt_fkey", ["pt_txt"], "app", "other", "id"),
		]);
		const other = tableFacts("other");
		const tables = [gen, other];
		const causes: ReadonlyMap<string, ColumnOmissionCause> = new Map([
			[
				"app.t.pt_txt",
				{
					cause: "generatedExpression",
					rootColumnIdentity: "app.t.pt",
					rootCause: "notInferred",
					rootNotInferredSqlType: "point",
				},
			],
		]);

		const result = partitionForeignKeys(
			tables,
			survivingTableIdentitiesFor(tables),
			causes,
		);

		expect(result.omittedForeignKeysByColumn).toEqual([
			{
				schema: "app",
				table: "t",
				name: "t_pt_txt_fkey",
				columnIdentity: "app.t.pt_txt",
				end: "source",
				cause: "generatedExpression",
				rootColumnIdentity: "app.t.pt",
				rootCause: "notInferred",
				rootNotInferredSqlType: "point",
			},
		]);
	});

	/** Regression control: a first-order type cause (no generated column involved) already carried its own `sqlType` before this fix, and must go on doing so. */
	it("regression: a foreign key directly into a not-inferred-type column (no generated column involved) already carries its own sqlType", () => {
		const moneyTable = tableFacts("money_table");
		const ref = tableFacts("money_ref", [
			foreignKeyToColumn(
				"money_ref_m_fkey",
				["m"],
				"app",
				"money_table",
				"mny",
			),
		]);
		const tables = [moneyTable, ref];
		const causes: ReadonlyMap<string, ColumnOmissionCause> = new Map([
			["app.money_table.mny", { cause: "notInferred", sqlType: "money" }],
		]);

		const result = partitionForeignKeys(
			tables,
			survivingTableIdentitiesFor(tables),
			causes,
		);

		expect(result.omittedForeignKeysByColumn).toEqual([
			{
				schema: "app",
				table: "money_ref",
				name: "money_ref_m_fkey",
				columnIdentity: "app.money_table.mny",
				end: "target",
				cause: "notInferred",
				notInferredSqlType: "money",
			},
		]);
	});
});
