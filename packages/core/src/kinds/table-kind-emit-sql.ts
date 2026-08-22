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
	columnUniqueName,
	foreignKeyOnDelete,
	foreignKeyOnUpdate,
	indexColumnDesc,
	indexColumnNulls,
	indexUnique,
	indexWhere,
	tableChecks,
	tablePrimaryKeyName,
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

/**
 * Renders `constraint "<name>" unique` (#24/D68) — named explicitly
 * (rather than a bare `unique` and letting Postgres pick its own default
 * name) so the identifier actually created always matches
 * `ColumnSnapshot.uniqueName`, the name frozen into the snapshot; an
 * implicit dependency on Postgres's own naming convention happening to
 * agree is exactly what D68 records the name to avoid. `columnUniqueName`
 * is only ever absent when `columnUnique` is `false` (paired fields,
 * `uniqueNameField`/`columnUniqueField` in `table-kind.ts`), so the empty
 * case here can't diverge from `columnUnique`'s own.
 */
const uniqueClause = (column: ColumnSnapshot): ReadonlyArray<string> => {
	const name = columnUniqueName(column);
	if (name === null) {
		return [];
	}
	return ["constraint", quoteIdentifier(name), "unique"];
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

/**
 * Renders `constraint "<name>" primary key (...)` (#24/D68) — named
 * explicitly for the same reason {@link uniqueClause} is: the identifier
 * actually created must match `TableSnapshot.primaryKeyName`, the name
 * frozen into the snapshot, rather than relying on Postgres's own default
 * naming convention agreeing by coincidence. `primaryKeyName` is only
 * ever absent when no column has `primaryKey: true` (`primaryKeyNameField`
 * in `table-kind.ts`), matching `primaryKeyColumns.length === 0` below.
 */
const primaryKeyConstraint = (
	snapshot: TableSnapshot,
): ReadonlyArray<string> => {
	const primaryKeyColumns = snapshot.columns
		.filter((column) => columnPrimaryKey(column))
		.map((column) => quoteIdentifier(column.name));
	const name = tablePrimaryKeyName(snapshot);
	if (primaryKeyColumns.length === 0 || name === null) {
		return [];
	}
	return [
		`constraint ${quoteIdentifier(name)} primary key (${primaryKeyColumns.join(", ")})`,
	];
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
		...primaryKeyConstraint(snapshot),
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

/** The column/expression token of one index column's clause — an expression entry (R5) is US3's (T039): unreachable today because nothing before this point can produce one (a real internal-bug guard, not a structurally-unreachable `assertNever` case, same technique as {@link ../kinds/schema-kind.ts}'s `emitAlter`). */
const indexColumnTarget = (column: IndexColumnSnapshot): string => {
	if ("name" in column) {
		return quoteIdentifier(column.name);
	}
	return throwHejbroError(
		"unsupported-operation",
		"expression index columns are not yet emittable — this indicates an internal hejbro bug (US3/T039 lands the expression branch).",
	);
};

/** Renders one index column's clause: name, then `desc` when descending, then `nulls first|last` when set (D51). */
const indexColumnSql = (column: IndexColumnSnapshot): string =>
	[
		indexColumnTarget(column),
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

/** Renders `alter table … add constraint "name" primary key (…);` (#24) — the ALTER-time counterpart of `createTableSql`'s inline `primaryKeyConstraint`, used both for a PK added to an existing table and for the add half of a composite PK's partial-drop repair (`table-kind-emit.ts`'s `emitAlter`). */
export const addPrimaryKeyConstraintSql = (
	schema: string,
	tableName: string,
	constraintName: string,
	columnNames: ReadonlyArray<string>,
): string =>
	`alter table ${qualifyName(schema, tableName)} add constraint ${quoteIdentifier(constraintName)} primary key (${columnNames.map(quoteIdentifier).join(", ")});`;

/** Renders `alter table … drop constraint …;` — shared by foreign keys, checks, and primary keys (the constraint namespace is one per table in Postgres). */
export const dropConstraintSql = (
	schema: string,
	tableName: string,
	constraintName: string,
): string =>
	`alter table ${qualifyName(schema, tableName)} drop constraint ${quoteIdentifier(constraintName)};`;
