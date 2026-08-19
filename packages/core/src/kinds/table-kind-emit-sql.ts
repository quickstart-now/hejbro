import type { ForeignKeyAction } from "../dsl/table";
import { throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import { renderTypeNode } from "../types/type-node";
import type {
	ColumnSnapshot,
	ForeignKeySnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "./table-snapshot";
import {
	columnDefault,
	columnNotNull,
	columnPrimaryKey,
	columnUnique,
	foreignKeyOnDelete,
	indexUnique,
} from "./table-snapshot";

/** Splits a `"schema.table"` identity string into its parts. */
export const splitTableIdentity = (
	identity: string,
): { readonly schema: string; readonly table: string } => {
	const dotIndex = identity.indexOf(".");
	if (dotIndex === -1) {
		return throwHejbroError(
			"invalid-table-identity",
			`table identity "${identity}" is missing a schema qualifier ("schema.table").`,
		);
	}
	return {
		schema: identity.slice(0, dotIndex),
		table: identity.slice(dotIndex + 1),
	};
};

const notNullClause = (column: ColumnSnapshot): ReadonlyArray<string> => {
	if (columnNotNull(column)) {
		return ["not null"];
	}
	return [];
};

const defaultClause = (column: ColumnSnapshot): ReadonlyArray<string> => {
	const value = columnDefault(column);
	if (value === null) {
		return [];
	}
	return [`default ${value}`];
};

const uniqueClause = (column: ColumnSnapshot): ReadonlyArray<string> => {
	if (!columnUnique(column)) {
		return [];
	}
	return ["unique"];
};

/** Renders one column's full definition clause (name, type, not null, default, unique). */
export const renderColumnDefinition = (column: ColumnSnapshot): string =>
	[
		quoteIdentifier(column.name),
		renderTypeNode(column.typeNode),
		...notNullClause(column),
		...defaultClause(column),
		...uniqueClause(column),
	].join(" ");

const primaryKeyConstraint = (
	columns: ReadonlyArray<ColumnSnapshot>,
): ReadonlyArray<string> => {
	const primaryKeyColumns = columns
		.filter((column) => columnPrimaryKey(column))
		.map((column) => quoteIdentifier(column.name));
	if (primaryKeyColumns.length === 0) {
		return [];
	}
	return [`primary key (${primaryKeyColumns.join(", ")})`];
};

/** Renders `create table … (…);` for a table snapshot, columns in declaration order, then table-level constraints. */
export const createTableSql = (snapshot: TableSnapshot): string => {
	const bodyLines = [
		...snapshot.columns.map((column) => renderColumnDefinition(column)),
		...primaryKeyConstraint(snapshot.columns),
	];
	return `create table ${qualifyName(snapshot.schema, snapshot.name)} (\n\t${bodyLines.join(",\n\t")}\n);`;
};

const uniqueIndexKeyword = (index: IndexSnapshot): string => {
	if (indexUnique(index)) {
		return "unique ";
	}
	return "";
};

/** Renders `create [unique] index "name" on "schema"."table" (…);`. */
export const createIndexSql = (
	schema: string,
	tableName: string,
	index: IndexSnapshot,
): string =>
	`create ${uniqueIndexKeyword(index)}index ${quoteIdentifier(index.name)} on ${qualifyName(schema, tableName)} (${index.columns
		.map((column) => quoteIdentifier(column))
		.join(", ")});`;

const foreignKeyActionClause = (onDelete: ForeignKeyAction | null): string => {
	if (onDelete === null) {
		return "";
	}
	return ` on delete ${onDelete}`;
};

/** Renders `alter table … add constraint … foreign key (…) references … (…) [on delete …];`. */
export const addForeignKeyConstraintSql = (
	schema: string,
	tableName: string,
	foreignKey: ForeignKeySnapshot,
): string => {
	const referenced = splitTableIdentity(foreignKey.referencesTable);
	const localColumns = foreignKey.columns
		.map((column) => quoteIdentifier(column))
		.join(", ");
	const referencedColumns = foreignKey.referencesColumns
		.map((column) => quoteIdentifier(column))
		.join(", ");
	return `alter table ${qualifyName(schema, tableName)} add constraint ${quoteIdentifier(foreignKey.name)} foreign key (${localColumns}) references ${qualifyName(
		referenced.schema,
		referenced.table,
	)} (${referencedColumns})${foreignKeyActionClause(foreignKeyOnDelete(foreignKey))};`;
};

/** Renders `alter table … drop constraint …;`. */
export const dropForeignKeyConstraintSql = (
	schema: string,
	tableName: string,
	foreignKeyName: string,
): string =>
	`alter table ${qualifyName(schema, tableName)} drop constraint ${quoteIdentifier(foreignKeyName)};`;
