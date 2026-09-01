import { captureDeclarationSite } from "../declaration-site";
import { assertSqlName } from "../sql/identifier-rules";
import type { ColumnBuilder } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";
import type { Table, TableDeclaration } from "./table";
import { buildColumnEntries, buildColumnRefs, tableMeta } from "./table";

/**
 * A reference-only table (D41): usable as an FK target, in `exists()`, and
 * in view from/joins — never passed to `generateMigration`, never diffed,
 * never emitted (passing one as a declaration is the hard error
 * `existing-table-declared`). Column names go through the same
 * snake_case + D36 rules as `table()`. Builds an inline `SchemaDeclaration`
 * that is never exported and never declared, so referencing an existing
 * table never emits `create schema`.
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
