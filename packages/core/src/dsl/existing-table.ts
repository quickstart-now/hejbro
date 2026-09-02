import { captureDeclarationSite } from "../declaration-site";
import { assertSqlName } from "../sql/identifier-rules";
import type { ColumnBuilder } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";
import type { Table, TableDeclaration } from "./table";
import { buildColumnEntries, buildColumnRefs, tableMeta } from "./table";

/**
 * An unmanaged table (D41, add-unmanaged-objects): usable as an FK target,
 * in `exists()`, in view from/joins, and — since add-unmanaged-objects —
 * as a top-level declaration itself: the snapshot records it unmanaged
 * (`unmanaged: true`, `kinds/table-snapshot.ts`) and `generateMigration`
 * emits and diffs nothing for it (`tableKind.diff`'s DDL-blocking guard).
 * Column names go through the same snake_case + D36 rules as `table()`.
 * Builds an inline `SchemaDeclaration` that is never exported and never
 * declared, so referencing an existing table never emits `create schema`.
 */
export const existingTable = <TColumns extends Record<string, ColumnBuilder>>(
	schemaName: string,
	tableName: string,
	columns: TColumns,
): Table<TColumns, "declared"> => {
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
		foreignKeys: [],
		checks: [],
		rls: null,
		existing: true,
		authority: "declared",
		declaredAt,
	};

	return Object.assign(refsObject, { [tableMeta]: declaration }) as Table<
		TColumns,
		"declared"
	>;
};
