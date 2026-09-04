import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	emptySnapshot,
	existingTable,
	generateMigration,
	getTableMeta,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog, ColumnRow } from "../src/check/catalog";
import { buildInventory } from "../src/check/inventory";

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
	extensions: [],
});

describe("buildInventory / 5.1 unmanaged tables", () => {
	it("lists an unmanaged table and still exits zero", () => {
		// "still exits zero" is enforced by construction, not by this test:
		// buildInventory never produces a Finding (no code, no HejbroError --
		// 2.1's own code set has no inventory entry), so nothing it returns
		// can ever affect renderCheckReport's exit code. check-command.test.ts's
		// "prints the inventory section in the report" test asserts that
		// end-to-end (findings: [], inventory non-empty -> exitCode: 0).
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "app", table: "legacy_table", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([
			{ schema: "app", table: "legacy_table" },
		]);
	});

	it("does not list a table in a schema no declaration touches", () => {
		// "inside the declared schemas" (spec) -- a table in a schema this
		// project never declares anything in is not this project's business
		// to report at all, managed or not.
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "other", table: "unrelated", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([]);
	});

	it("does not list a declared table as unmanaged", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([]);
	});
});

describe("buildInventory / 5.1 extensions", () => {
	it("lists the installed extensions", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
			extensions: [{ name: "pgcrypto" }, { name: "uuid-ossp" }],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.extensions).toEqual(["pgcrypto", "uuid-ossp"]);
	});
});

const columnRow = (
	schema: string,
	table: string,
	name: string,
	overrides: Partial<ColumnRow> = {},
): ColumnRow => ({
	schema,
	table,
	name,
	notNull: false,
	catalogType: "text",
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: null,
	catalogDefault: null,
	catalogGenerated: null,
	...overrides,
});

describe("the inventory's anchor is a managed table", () => {
	// harden-check-inventory, task 1.1 (#707/#726): the object-level axes
	// (columns here; indexes and check constraints follow the same anchor
	// in 1.4/1.5) only ever fire on a table a `table:` declaration
	// manages -- not an unmanaged table (its own line already says
	// everything true), not an `existingTable()` (a declared shape this
	// project does not own), and never outside a declared schema.
	type AnchorRow = {
		readonly label: string;
		readonly declarations: ReadonlyArray<HejbroInput>;
		readonly catalogTables: Catalog["tables"];
		readonly catalogColumns: ReadonlyArray<ColumnRow>;
		readonly expectedUnmanagedColumns: ReadonlyArray<{
			readonly schema: string;
			readonly table: string;
			readonly name: string;
		}>;
		readonly expectedUnmanagedTables: ReadonlyArray<{
			readonly schema: string;
			readonly table: string;
		}>;
	};

	const rows: ReadonlyArray<AnchorRow> = [
		{
			label: "a table a `table:` declaration manages",
			declarations: [table(app, "posts", { id: uuid().primaryKey() })],
			catalogTables: [{ schema: "app", table: "posts", rls: false }],
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "posts", "legacy_note"),
			],
			expectedUnmanagedColumns: [
				{ schema: "app", table: "posts", name: "legacy_note" },
			],
			expectedUnmanagedTables: [],
		},
		{
			label: "a catalog table no declaration covers",
			declarations: [table(app, "posts", { id: uuid().primaryKey() })],
			catalogTables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "app", table: "legacy_table", rls: false },
			],
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "legacy_table", "note"),
			],
			expectedUnmanagedColumns: [],
			expectedUnmanagedTables: [{ schema: "app", table: "legacy_table" }],
		},
		{
			label: "a table declared `existingTable()`",
			declarations: [
				getTableMeta(existingTable("app", "legacy_customers", { id: uuid() })),
			],
			catalogTables: [{ schema: "app", table: "legacy_customers", rls: false }],
			catalogColumns: [
				columnRow("app", "legacy_customers", "id"),
				columnRow("app", "legacy_customers", "legacy_note"),
			],
			expectedUnmanagedColumns: [],
			expectedUnmanagedTables: [],
		},
		{
			label: "a table in a schema no declaration touches",
			declarations: [table(app, "posts", { id: uuid().primaryKey() })],
			catalogTables: [{ schema: "other", table: "unrelated", rls: false }],
			catalogColumns: [columnRow("other", "unrelated", "note")],
			expectedUnmanagedColumns: [],
			expectedUnmanagedTables: [],
		},
		{
			// D106 R3/#665: `declaredSchemaNames` does not count an
			// `existingTable()` node as declaring its schema, so a sibling
			// table in that same schema is out of scope for a different
			// reason than "no declaration touches it at all" (the previous
			// row) -- this row pins that distinct path so a later change to
			// `declaredSchemaNames`'s existing-table exclusion cannot pass
			// silently.
			label: "a schema only an `existingTable()` declaration touches",
			declarations: [
				getTableMeta(existingTable("app", "legacy_customers", { id: uuid() })),
			],
			catalogTables: [
				{ schema: "app", table: "legacy_customers", rls: false },
				{ schema: "app", table: "sibling_table", rls: false },
			],
			catalogColumns: [
				columnRow("app", "legacy_customers", "id"),
				columnRow("app", "sibling_table", "note"),
			],
			expectedUnmanagedColumns: [],
			expectedUnmanagedTables: [],
		},
	];

	it.each(rows)(
		"$label",
		({
			declarations,
			catalogTables,
			catalogColumns,
			expectedUnmanagedColumns,
			expectedUnmanagedTables,
		}) => {
			const snapshot = buildTestSnapshot(declarations);
			const catalog: Catalog = {
				...emptyCatalog(),
				tables: catalogTables,
				columns: catalogColumns,
			};

			const inventory = buildInventory(snapshot, catalog);

			expect(inventory.unmanagedColumns).toEqual(expectedUnmanagedColumns);
			expect(inventory.unmanagedTables).toEqual(expectedUnmanagedTables);
		},
	);
});

describe("unmanaged columns", () => {
	// harden-check-inventory, task 1.3 (#726): every kind of database-only
	// column on a managed table is listed by identity alone -- existence
	// only, by construction (spec Req5): `unmanagedColumns` never reads a
	// row's `catalogType`, `catalogDefault` or `catalogGenerated`, so a
	// generated or identity column is exactly as reportable as a plain
	// one, and an undeclarable name (#706's own loss-report subject)
	// passes through unchanged.
	type ColumnKindRow = {
		readonly label: string;
		readonly catalogColumns: ReadonlyArray<ColumnRow>;
		readonly expectedUnmanagedColumns: ReadonlyArray<{
			readonly schema: string;
			readonly table: string;
			readonly name: string;
		}>;
	};

	const posts = table(app, "posts", { id: uuid().primaryKey() });
	const snapshot = buildTestSnapshot([posts]);

	const rows: ReadonlyArray<ColumnKindRow> = [
		{
			label: "a column the declaration covers",
			catalogColumns: [columnRow("app", "posts", "id")],
			expectedUnmanagedColumns: [],
		},
		{
			label: "a database-only plain column",
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "posts", "legacy_note"),
			],
			expectedUnmanagedColumns: [
				{ schema: "app", table: "posts", name: "legacy_note" },
			],
		},
		{
			label: "a database-only generated column",
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "posts", "legacy_total", {
					catalogGenerated: "(price * (qty)::numeric)",
				}),
			],
			expectedUnmanagedColumns: [
				{ schema: "app", table: "posts", name: "legacy_total" },
			],
		},
		{
			// The columns query (check/catalog.ts) carries no identity-specific
			// field -- an identity column's row is indistinguishable from a
			// plain one at this level, which is exactly why no special case
			// is needed: `unmanagedColumns` never looks past the name either
			// way.
			label: "a database-only identity column",
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "posts", "legacy_seq"),
			],
			expectedUnmanagedColumns: [
				{ schema: "app", table: "posts", name: "legacy_seq" },
			],
		},
		{
			label: "a column whose name no declaration could carry",
			catalogColumns: [
				columnRow("app", "posts", "id"),
				columnRow("app", "posts", "_id"),
			],
			expectedUnmanagedColumns: [
				{ schema: "app", table: "posts", name: "_id" },
			],
		},
	];

	it.each(rows)("$label", ({ catalogColumns, expectedUnmanagedColumns }) => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
			columns: catalogColumns,
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedColumns).toEqual(expectedUnmanagedColumns);
	});
});
