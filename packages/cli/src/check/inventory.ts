import type { Snapshot } from "@hejbro/core";
import type { Catalog } from "./catalog";

/** This module's own "unmanaged" (spec Req5): a catalog table no declaration covers at all -- not the same axis as `existingTable()` (add-unmanaged-objects), which *is* a declaration and so never appears here. */
export type UnmanagedTable = {
	readonly schema: string;
	readonly table: string;
};

/**
 * Existence-only information (spec Req5): tables inside a declared
 * schema that no declaration covers, and the extensions the database
 * has. Neither carries a hejbro error code -- 2.1's own code set has no
 * inventory entry, because this is never a difference (a project may
 * legitimately leave objects unmanaged) and SHALL NOT affect the exit
 * code. Existence only, by construction: nothing here compares a type,
 * a default, or an expression, so nothing here can produce a false
 * positive.
 */
export type Inventory = {
	readonly unmanagedTables: ReadonlyArray<UnmanagedTable>;
	readonly extensions: ReadonlyArray<string>;
};

// Mirrors compare.ts's own internal-invariant idiom (table shapes aren't
// part of core's public surface).
type LocalObjectWithSchema = { readonly schema: string };

/** Every schema any declared object touches -- "the declared schemas" (spec), read from every kind's own `schema` field, not only `schema:` entries (a project's declarations may never explicitly declare the `schema()` object itself). */
const declaredSchemaNames = (snapshot: Snapshot): ReadonlySet<string> =>
	new Set(
		Object.values(snapshot.objects)
			.map((node) => (node as LocalObjectWithSchema).schema)
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
	extensions: catalog.extensions.map((row) => row.name),
});
