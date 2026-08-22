import type { ForeignKeyAction } from "../dsl/table";
import { throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import { renderTypeNode } from "../types/type-node";
import type {
	CheckSnapshot,
	ColumnSnapshot,
	ForeignKeySnapshot,
	IndexColumnSnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "./table-snapshot";
import {
	checkExpression,
	columnDefault,
	columnNotNull,
	columnPrimaryKey,
	columnUnique,
	foreignKeyOnDelete,
	foreignKeyOnUpdate,
	indexColumnDesc,
	indexColumnNulls,
	indexUnique,
	indexWhere,
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

const defaultClause = (value: string | null): ReadonlyArray<string> => {
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

/**
 * Renders one column's full definition clause (name, type, not null,
 * default, unique). `overrideDefault` (D74), when given, replaces
 * `columnDefault(column)` as the default's SQL text — used for a
 * serial-family column added to an *existing* table (#23): its default
 * lives in a sibling `sequence` change, never `ColumnSnapshot.default`
 * (see `table-kind-emit.ts`'s own `add column` rendering), so the value
 * has to come from outside this column's own snapshot.
 */
export const renderColumnDefinition = (
	column: ColumnSnapshot,
	overrideDefault?: string,
): string =>
	[
		quoteIdentifier(column.name),
		renderTypeNode(column.typeNode),
		...notNullClause(column),
		...defaultClause(overrideDefault ?? columnDefault(column)),
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
			`constraint ${quoteIdentifier(check.name)} check (${checkExpression(check)})`,
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

const descKeyword = (column: IndexColumnSnapshot): ReadonlyArray<string> => {
	if (indexColumnDesc(column)) {
		return ["desc"];
	}
	return [];
};

const nullsClause = (column: IndexColumnSnapshot): ReadonlyArray<string> => {
	const nulls = indexColumnNulls(column);
	if (nulls === null) {
		return [];
	}
	return [`nulls ${nulls}`];
};

/** Renders one index column's clause: name, then `desc` when descending, then `nulls first|last` when set (D51). */
const indexColumnSql = (column: IndexColumnSnapshot): string =>
	[
		quoteIdentifier(column.name),
		...descKeyword(column),
		...nullsClause(column),
	].join(" ");

/** Renders ` where <predicate>` for a partial index, or `""` when the index has none (D51). */
const whereClause = (index: IndexSnapshot): string => {
	const predicate = indexWhere(index);
	if (predicate === null) {
		return "";
	}
	return ` where ${predicate}`;
};

/** Renders `create [unique] index "name" on "schema"."table" (…) [where …];`, columns in declared order with their sort direction and nulls placement (D51). */
export const createIndexSql = (
	schema: string,
	tableName: string,
	index: IndexSnapshot,
): string =>
	`create ${uniqueIndexKeyword(index)}index ${quoteIdentifier(index.name)} on ${qualifyName(schema, tableName)} (${index.columns
		.map(indexColumnSql)
		.join(", ")})${whereClause(index)};`;

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
	`alter table ${qualifyName(schema, tableName)} add constraint ${quoteIdentifier(check.name)} check (${checkExpression(check)});`;

/** Renders `alter table … drop constraint …;` — shared by foreign keys and checks (the constraint namespace is one per table in Postgres). */
export const dropConstraintSql = (
	schema: string,
	tableName: string,
	constraintName: string,
): string =>
	`alter table ${qualifyName(schema, tableName)} drop constraint ${quoteIdentifier(constraintName)};`;
