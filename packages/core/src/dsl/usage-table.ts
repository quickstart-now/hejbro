import { captureDeclarationSite } from "../declaration-site";
import { assertSqlName } from "../sql/identifier-rules";
import type { ColumnBuilder } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";
import type { Table, TableDeclaration } from "./table";
import {
	buildColumnEntries,
	buildColumnRefs,
	foldColumnReferences,
	tableMeta,
} from "./table";

/**
 * A table read back from a database this repository does not own (`hejbro
 * sync`'s own output, D87 polyrepo-sync): the same consumer-visible type
 * layer as `table()` — TypeScript keys, numeric mode, non-null array
 * elements, and relation keys via `.references()` — but no migration
 * authority (`Table<TColumns, "usage">`, never `DeclaredTable`). Not
 * assignable to `generateMigration`'s input at the type level; the
 * runtime chokepoint (`engine/generate.ts`'s `resolveTableDeclarations`)
 * refuses it too, for a caller the type layer never saw (a JS project, or
 * a config file `jiti` loads without a compile step). `hejbro sync` is
 * this constructor's only sanctioned caller, but nothing here checks
 * who's calling — the refusal rests on the absence of authority in the
 * value itself, not on provenance.
 */
export const syncedTable = <TColumns extends Record<string, ColumnBuilder>>(
	schemaName: string,
	tableName: string,
	columns: TColumns,
	options?: {
		/** The manifest row this table was read from — the same string a
		 * synced module exports as its freshness stamp. Optional: a
		 * hand-built usage table (a test fixture, or a caller the type
		 * layer never saw) carries none, which is exactly how its refusal
		 * ends up naming no origin either. */
		readonly origin?: string;
	},
): Table<TColumns, "usage"> => {
	const declaredAt = captureDeclarationSite();
	assertSqlName(schemaName, "schema", declaredAt);
	assertSqlName(tableName, "table", declaredAt);
	const owner: SchemaDeclaration = { declarationKind: "schema", schemaName };
	const columnEntries = buildColumnEntries(tableName, columns);
	const refsObject = buildColumnRefs<TColumns>(owner, tableName, columnEntries);

	const declaration: TableDeclaration = {
		declarationKind: "table",
		schema: owner,
		tableName,
		columns: columnEntries.map((entry) => ({
			columnKey: entry.columnKey,
			columnName: entry.columnName,
			columnState: entry.columnState,
		})),
		indexes: [],
		foreignKeys: foldColumnReferences(tableName, columnEntries),
		checks: [],
		rls: null,
		existing: false,
		authority: "usage",
		...(options?.origin !== undefined && { origin: options.origin }),
		declaredAt,
	};

	return Object.assign(refsObject, { [tableMeta]: declaration }) as Table<
		TColumns,
		"usage"
	>;
};
