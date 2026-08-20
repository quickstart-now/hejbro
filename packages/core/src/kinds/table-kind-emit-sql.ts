import type { ForeignKeyAction } from "../dsl/table";
import { throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import { renderTypeNode } from "../types/type-node";
import type {
	CheckSnapshot,
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
	foreignKeyOnUpdate,
	indexUnique,
	tableChecks,
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

const checkConstraintLines = (snapshot: TableSnapshot): ReadonlyArray<string> =>
	tableChecks(snapshot).map(
		(check) =>
			`constraint ${quoteIdentifier(check.name)} check (${check.expression})`,
	);

/** Renders `create table … (…);` for a table snapshot, columns in declaration order, then table-level constraints (primary key, then CHECKs, D50). */
export const createTableSql = (snapshot: TableSnapshot): string => {
	const bodyLines = [
		...snapshot.columns.map((column) => renderColumnDefinition(column)),
		...primaryKeyConstraint(snapshot.columns),
		...checkConstraintLines(snapshot),
	];
	return `create table ${qualifyName(snapshot.schema, snapshot.name)} (\n\t${bodyLines.join(",\n\t")}\n);`;
};

const uniqueIndexKeyword = (index: IndexSnapshot): string => {
	if (indexUnique(index)) {
		return "unique ";
	}
	return "";
};

/** Renders `create [unique] index "name" on "schema"."table" (…);`. Task 11 note: ordering (`desc`/`nulls`) and a partial index's `where` are not yet rendered here — that lands in Task 12; for now this only keeps the v3 snapshot shape compiling. */
export const createIndexSql = (
	schema: string,
	tableName: string,
	index: IndexSnapshot,
): string =>
	`create ${uniqueIndexKeyword(index)}index ${quoteIdentifier(index.name)} on ${qualifyName(schema, tableName)} (${index.columns
		.map((column) => quoteIdentifier(column.name))
		.join(", ")});`;

const foreignKeyActionClause = (
	keyword: "delete" | "update",
	action: ForeignKeyAction | null,
): string => {
	if (action === null) {
		return "";
	}
	return ` on ${keyword} ${action}`;
};

/** Renders `alter table … add constraint … foreign key (…) references … (…) [on delete …] [on update …];`. */
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
	)} (${referencedColumns})${foreignKeyActionClause("delete", foreignKeyOnDelete(foreignKey))}${foreignKeyActionClause("update", foreignKeyOnUpdate(foreignKey))};`;
};

/** Renders `alter table … add constraint "name" check (…);`. */
export const addCheckConstraintSql = (
	schema: string,
	tableName: string,
	check: CheckSnapshot,
): string =>
	`alter table ${qualifyName(schema, tableName)} add constraint ${quoteIdentifier(check.name)} check (${check.expression});`;

/** Renders `alter table … drop constraint …;` — shared by foreign keys and checks (the constraint namespace is one per table in Postgres). */
export const dropConstraintSql = (
	schema: string,
	tableName: string,
	constraintName: string,
): string =>
	`alter table ${qualifyName(schema, tableName)} drop constraint ${quoteIdentifier(constraintName)};`;
