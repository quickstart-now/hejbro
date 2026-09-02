import type { Catalog } from "../check/catalog";
import { orderedColumnsWithKeys } from "./adapter";
import type { InferenceCatalog } from "./catalog";
import { inferRoleNames } from "./rest";

export type DescribedColumn = {
	readonly sqlName: string;
	readonly tsKey: string;
};

export type DescribedTable = {
	readonly schema: string;
	readonly table: string;
	readonly columns: ReadonlyArray<DescribedColumn>;
};

export type CatalogDescription = {
	readonly tables: ReadonlyArray<DescribedTable>;
	readonly roleNames: ReadonlyArray<string>;
};

/**
 * The catalog-inference delta's own description rule, built from the
 * catalog reading directly (CI-G1-R1-08 (C), lead's ruling) -- never
 * from a declaration round trip. Every column the shared inventory
 * found is carried with a guessed key, including one 1.3 would drop as
 * a loss (no column builder expresses its type) and one whose SQL name
 * a declaration key can never reproduce (CI-G1-R1-06 (C)): `pull`'s own
 * contract needs both, since its columns are never filtered by
 * declarability the way `import`'s starter files are.
 */
export const describeCatalog = (
	catalog: Catalog,
	inferenceCatalog: InferenceCatalog,
): CatalogDescription => ({
	tables: catalog.tables.map((tableRow) => {
		const { columns, tsKeys } = orderedColumnsWithKeys(
			catalog,
			inferenceCatalog,
			tableRow.schema,
			tableRow.table,
		);
		return {
			schema: tableRow.schema,
			table: tableRow.table,
			columns: columns.map((column, index) => ({
				sqlName: column.name,
				tsKey: tsKeys[index] ?? column.name,
			})),
		};
	}),
	roleNames: inferRoleNames(catalog),
});
