import type { Snapshot } from "@hejbro/core";
import type { Catalog } from "./catalog";

/** This module's own "unmanaged" (spec Req5): a catalog table no declaration covers at all -- not the same axis as `existingTable()` (add-unmanaged-objects), which *is* a declaration and so never appears here. */
export type UnmanagedTable = {
	readonly schema: string;
	readonly table: string;
};

/** A column the database holds on a *managed* table that no declaration covers (harden-check-inventory, #726) -- the object-level counterpart of {@link UnmanagedTable}, anchored the same way (see {@link managedTableIdentities}). */
export type UnmanagedColumn = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
};

/**
 * Existence-only information (spec Req5): tables inside a declared
 * schema that no declaration covers, columns on a managed table that no
 * declaration covers, and the extensions the database has. Neither
 * carries a hejbro error code -- 2.1's own code set has no inventory
 * entry, because this is never a difference (a project may legitimately
 * leave objects unmanaged) and SHALL NOT affect the exit code.
 * Existence only, by construction: nothing here compares a type, a
 * default, or an expression, so nothing here can produce a false
 * positive.
 */
export type Inventory = {
	readonly unmanagedTables: ReadonlyArray<UnmanagedTable>;
	readonly unmanagedColumns: ReadonlyArray<UnmanagedColumn>;
	readonly extensions: ReadonlyArray<string>;
};

// Mirrors compare.ts's own internal-invariant idiom (table shapes aren't
// part of core's public surface).
type LocalObjectWithSchema = { readonly schema: string };
type LocalTableWithExisting = {
	readonly schema: string;
	readonly existing?: true;
};
type LocalColumnNode = { readonly name: string };
type LocalTableWithColumns = {
	readonly columns: ReadonlyArray<LocalColumnNode>;
};

/**
 * Every schema any declared object touches -- "the declared schemas"
 * (spec), read from every kind's own `schema` field, not only `schema:`
 * entries (a project's declarations may never explicitly declare the
 * `schema()` object itself). D106 R3, #665: an `existingTable()` node
 * does not count -- it declares one table's own shape, not that this
 * project has anything to say about the rest of its schema, so a single
 * existing declaration must not pull every other catalog table in that
 * schema into the inventory. Only a *managed* `table:` node (or any
 * non-table kind -- `schema:`, `grant:`, a function, a view -- which
 * carry no existing/managed distinction at all) still marks its schema
 * declared.
 */
const declaredSchemaNames = (snapshot: Snapshot): ReadonlySet<string> =>
	new Set(
		Object.entries(snapshot.objects)
			.filter(([key, node]) => {
				if (!key.startsWith("table:")) {
					return true;
				}
				return (node as LocalTableWithExisting).existing !== true;
			})
			.map(([, node]) => (node as LocalObjectWithSchema).schema)
			.filter(
				(schemaName): schemaName is string => typeof schemaName === "string",
			),
	);

/** Every declared table's own identity (`schema.name`) -- a `table:` snapshot key's own suffix is already exactly this string (core's own `tableIdentity`), so no reassembly is needed. */
const declaredTableIdentities = (snapshot: Snapshot): ReadonlySet<string> =>
	new Set(
		Object.keys(snapshot.objects)
			.filter((key) => key.startsWith("table:"))
			.map((key) => key.slice("table:".length)),
	);

/**
 * Tables the catalog has, inside a schema the declarations touch, that
 * no `table:` declaration covers. A table in a schema the declarations
 * never touch at all is out of scope entirely -- not this project's
 * business to report, managed or not.
 */
const unmanagedTables = (
	snapshot: Snapshot,
	catalog: Catalog,
): ReadonlyArray<UnmanagedTable> => {
	const schemas = declaredSchemaNames(snapshot);
	const declaredTables = declaredTableIdentities(snapshot);
	return catalog.tables
		.filter((row) => schemas.has(row.schema))
		.filter((row) => !declaredTables.has(`${row.schema}.${row.table}`))
		.map((row) => ({ schema: row.schema, table: row.table }));
};

/** `declaredTableIdentities(snapshot)` narrowed to the ones declared `existing: true` -- the complement `managedTableIdentities` below removes. */
const existingTableIdentities = (snapshot: Snapshot): ReadonlySet<string> =>
	new Set(
		Object.entries(snapshot.objects)
			.filter(([key]) => key.startsWith("table:"))
			.filter(([, node]) => (node as LocalTableWithExisting).existing === true)
			.map(([key]) => key.slice("table:".length)),
	);

/**
 * The object-level inventory's own anchor (harden-check-inventory,
 * #707/#726): a table a `table:` declaration manages -- declared, and
 * not `existingTable()` (add-unmanaged-objects, D106 R3: an existing
 * declaration claims a shape hejbro does not own, so nothing on it is
 * hejbro's to call unmanaged). A table this set excludes for either
 * reason contributes no column, index or check-constraint line: an
 * undeclared table's own `unmanaged table` line already says everything
 * true about what it holds, and a schema no declaration touches is out
 * of scope by `declaredTableIdentities`/`declaredSchemaNames` never
 * naming it in the first place.
 */
const managedTableIdentities = (snapshot: Snapshot): ReadonlySet<string> => {
	const existing = existingTableIdentities(snapshot);
	return new Set(
		[...declaredTableIdentities(snapshot)].filter(
			(identity) => !existing.has(identity),
		),
	);
};

/** The column names a managed table's own declaration names, read from its snapshot node -- absent (schema no declaration touches, or the table itself unmanaged/existing) reads as no declared columns, which never matters: {@link unmanagedColumns} only calls this for an identity `managedTableIdentities` already vouches for. */
const declaredColumnNames = (
	snapshot: Snapshot,
	identity: string,
): ReadonlySet<string> => {
	const node = snapshot.objects[`table:${identity}`] as
		| LocalTableWithColumns
		| undefined;
	return new Set((node?.columns ?? []).map((column) => column.name));
};

/**
 * Columns the catalog has on a managed table that no declaration
 * covers (#726) -- the column-level counterpart of {@link
 * unmanagedTables}, anchored on {@link managedTableIdentities} rather
 * than `declaredSchemaNames`: a managed table's schema is always
 * declared by construction (it holds a `table:` declaration), so no
 * separate schema filter is needed here.
 */
const unmanagedColumns = (
	snapshot: Snapshot,
	catalog: Catalog,
): ReadonlyArray<UnmanagedColumn> => {
	const managedTables = managedTableIdentities(snapshot);
	return catalog.columns
		.filter((row) => managedTables.has(`${row.schema}.${row.table}`))
		.filter(
			(row) =>
				!declaredColumnNames(snapshot, `${row.schema}.${row.table}`).has(
					row.name,
				),
		)
		.map((row) => ({ schema: row.schema, table: row.table, name: row.name }));
};

/**
 * Builds the report's own inventory section (task 5.1) -- pure, no I/O
 * (group 1's `readCatalog` already ran), same split as `compare.ts` and
 * `expression.ts`.
 */
export const buildInventory = (
	snapshot: Snapshot,
	catalog: Catalog,
): Inventory => ({
	unmanagedTables: unmanagedTables(snapshot, catalog),
	unmanagedColumns: unmanagedColumns(snapshot, catalog),
	extensions: catalog.extensions.map((row) => row.name),
});
