import type {
	ForeignKeyAction,
	IndexDeclaration,
	IndexNulls,
	TableDeclaration,
} from "../dsl/table";
import type { ExprNode } from "../expr/ast";
import { encodeExprNode } from "../expr/codec";
import type { KeyedDiff } from "../kind/diff-helpers";
import { diffByKey } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import type { ColumnState } from "../types/column-builder";
import { emitTableSql } from "./table-kind-emit";
import type {
	CheckSnapshot,
	ColumnSnapshot,
	ForeignKeySnapshot,
	IndexColumnSnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "./table-snapshot";
import { asTableSnapshot, tableChecks, tableIdentity } from "./table-snapshot";

/** Derives an index's default name from its owning table and columns — shared with `engine/rename-plan.ts`'s drift guard (Phase 5). */
export const deriveIndexName = (
	tableName: string,
	columns: ReadonlyArray<string>,
): string => `${tableName}_${columns.join("_")}_idx`;

/** Derives a foreign key's default name from its owning table and local columns — shared with `engine/rename-plan.ts`'s drift guard (Phase 5). */
export const deriveForeignKeyName = (
	tableName: string,
	columns: ReadonlyArray<string>,
): string => `${tableName}_${columns.join("_")}_fk`;

/** `primaryKey` implies `notNull` once a column is materialized into a snapshot. */
const materializeNotNull = (columnState: ColumnState): boolean => {
	if (columnState.primaryKey) {
		return true;
	}
	return columnState.notNull;
};

const resolveIndexName = (
	tableName: string,
	index: IndexDeclaration,
): string => {
	if (index.indexName !== null) {
		return index.indexName;
	}
	return deriveIndexName(
		tableName,
		index.columns.map((column) => column.name),
	);
};

/** Encodes a column's default expression into its snapshot form (D67/D70) — `null` when the column has no default. */
const encodeColumnDefaultExpr = (
	columnState: ColumnState,
): JsonValue | null => {
	if (columnState.defaultValue === null) {
		return null;
	}
	return encodeExprNode(columnState.defaultValue);
};

/** `{ notNull: true }` when the column is not-null, else `{}` — the compact-snapshot building block (Task 3 audit / D33): a `false`-default field is never recorded. */
const notNullField = (value: boolean): Pick<ColumnSnapshot, "notNull"> => {
	if (!value) {
		return {};
	}
	return { notNull: true };
};

/** @see notNullField */
const primaryKeyField = (
	value: boolean,
): Pick<ColumnSnapshot, "primaryKey"> => {
	if (!value) {
		return {};
	}
	return { primaryKey: true };
};

/** @see notNullField */
const columnUniqueField = (value: boolean): Pick<ColumnSnapshot, "unique"> => {
	if (!value) {
		return {};
	}
	return { unique: true };
};

/** `{ default: <node> }` when the column has a default, else `{}` (compact snapshot). */
const defaultField = (
	value: JsonValue | null,
): Pick<ColumnSnapshot, "default"> => {
	if (value === null) {
		return {};
	}
	return { default: value };
};

/** @see notNullField */
const indexUniqueField = (value: boolean): Pick<IndexSnapshot, "unique"> => {
	if (!value) {
		return {};
	}
	return { unique: true };
};

/** `{ desc: true }` when the column sorts descending, else `{}` (compact snapshot). */
const indexColumnDescField = (
	value: boolean,
): Pick<IndexColumnSnapshot, "desc"> => {
	if (!value) {
		return {};
	}
	return { desc: true };
};

/** `{ nulls: <placement> }` when set, else `{}` (compact snapshot). */
const indexColumnNullsField = (
	value: IndexNulls | null,
): Pick<IndexColumnSnapshot, "nulls"> => {
	if (value === null) {
		return {};
	}
	return { nulls: value };
};

/** `{ where: <node> }` when the index has a partial predicate, else `{}` (compact snapshot). */
const whereField = (value: JsonValue | null): Pick<IndexSnapshot, "where"> => {
	if (value === null) {
		return {};
	}
	return { where: value };
};

/** `{ onDelete: <action> }` when set, else `{}` (compact snapshot — `null` means "unspecified"). */
const onDeleteField = (
	value: ForeignKeyAction | null,
): Pick<ForeignKeySnapshot, "onDelete"> => {
	if (value === null) {
		return {};
	}
	return { onDelete: value };
};

/** `{ onUpdate: <action> }` when set, else `{}` (compact snapshot — `null` means "unspecified"). */
const onUpdateField = (
	value: ForeignKeyAction | null,
): Pick<ForeignKeySnapshot, "onUpdate"> => {
	if (value === null) {
		return {};
	}
	return { onUpdate: value };
};

const serializeColumns = (
	declaration: TableDeclaration,
): ReadonlyArray<ColumnSnapshot> =>
	declaration.columns.map((entry) => ({
		name: entry.columnName,
		typeNode: entry.columnState.typeNode,
		...notNullField(materializeNotNull(entry.columnState)),
		...primaryKeyField(entry.columnState.primaryKey),
		...columnUniqueField(entry.columnState.unique),
		...defaultField(encodeColumnDefaultExpr(entry.columnState)),
	}));

const serializeIndexColumn = (
	column: IndexDeclaration["columns"][number],
): IndexColumnSnapshot => ({
	name: column.name,
	...indexColumnDescField(column.desc),
	...indexColumnNullsField(column.nulls),
});

/** Encodes a partial index's predicate into its snapshot form — `null` when the index has none. */
const encodePredicate = (predicate: ExprNode | null): JsonValue | null => {
	if (predicate === null) {
		return null;
	}
	return encodeExprNode(predicate);
};

const serializeIndexes = (
	declaration: TableDeclaration,
): ReadonlyArray<IndexSnapshot> =>
	declaration.indexes.map((index) => ({
		name: resolveIndexName(declaration.tableName, index),
		columns: index.columns.map(serializeIndexColumn),
		...indexUniqueField(index.unique),
		...whereField(encodePredicate(index.predicate)),
	}));

const serializeForeignKeys = (
	declaration: TableDeclaration,
): ReadonlyArray<ForeignKeySnapshot> =>
	declaration.foreignKeys.map((foreignKey) => ({
		name: deriveForeignKeyName(declaration.tableName, foreignKey.columns),
		columns: foreignKey.columns,
		referencesTable: tableIdentity(
			foreignKey.references.schemaName,
			foreignKey.references.tableName,
		),
		referencesColumns: foreignKey.references.columns,
		...onDeleteField(foreignKey.onDelete),
		...onUpdateField(foreignKey.onUpdate),
	}));

const serializeChecks = (
	declaration: TableDeclaration,
): ReadonlyArray<CheckSnapshot> =>
	declaration.checks.map((check) => ({
		name: check.checkName,
		expression: encodeExprNode(check.expression),
	}));

/** `{ checks }` when the table declares any, else `{}` — absent means "none" (compact snapshot). */
const checksField = (
	checks: ReadonlyArray<CheckSnapshot>,
): Pick<TableSnapshot, "checks"> => {
	if (checks.length === 0) {
		return {};
	}
	return { checks };
};

const isEmptyKeyedDiff = <TValue>(diff: KeyedDiff<TValue>): boolean =>
	diff.added.length === 0 &&
	diff.removed.length === 0 &&
	diff.changed.length === 0;

const buildNotes = <TValue>(
	label: string,
	diff: KeyedDiff<TValue>,
): ReadonlyArray<string> => [
	...diff.added.map((entry) => `${label} "${entry.key}" added`),
	...diff.removed.map((entry) => `${label} "${entry.key}" dropped`),
	...diff.changed.map((entry) => `${label} "${entry.key}" changed`),
];

/**
 * The built-in object kind for Postgres tables. Identity is
 * `"<schema>.<tableName>"`. `diff` reports one `create`/`drop` change for
 * whole tables, and a single `alter` change (notes listing every column,
 * index, and foreign key delta) for survivors — column reordering alone
 * produces no diff, since deltas are computed by name, not by array index.
 */
export const tableKind: ObjectKind<TableDeclaration> = {
	kind: "table",
	dependsOn: ["schema", "enum"],
	owns: (declaration): declaration is TableDeclaration =>
		declaration.declarationKind === "table",
	serialize: (declaration) => ({
		schema: declaration.schema.schemaName,
		name: declaration.tableName,
		columns: serializeColumns(declaration),
		indexes: serializeIndexes(declaration),
		foreignKeys: serializeForeignKeys(declaration),
		...checksField(serializeChecks(declaration)),
	}),
	identify: (snapshot) => {
		const tableSnapshot = asTableSnapshot(snapshot);
		return tableIdentity(tableSnapshot.schema, tableSnapshot.name);
	},
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "table",
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			];
		}
		if (previous !== null && next === null) {
			return [
				{
					kind: "table",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			];
		}
		if (previous === null || next === null) {
			return [];
		}

		const previousSnapshot = asTableSnapshot(previous);
		const nextSnapshot = asTableSnapshot(next);

		const columnDiff = diffByKey(
			previousSnapshot.columns.map((column) => ({
				key: column.name,
				value: column,
			})),
			nextSnapshot.columns.map((column) => ({
				key: column.name,
				value: column,
			})),
		);
		const indexDiff = diffByKey(
			previousSnapshot.indexes.map((index) => ({
				key: index.name,
				value: index,
			})),
			nextSnapshot.indexes.map((index) => ({ key: index.name, value: index })),
		);
		const foreignKeyDiff = diffByKey(
			previousSnapshot.foreignKeys.map((foreignKey) => ({
				key: foreignKey.name,
				value: foreignKey,
			})),
			nextSnapshot.foreignKeys.map((foreignKey) => ({
				key: foreignKey.name,
				value: foreignKey,
			})),
		);
		const checkDiff = diffByKey(
			tableChecks(previousSnapshot).map((check) => ({
				key: check.name,
				value: check,
			})),
			tableChecks(nextSnapshot).map((check) => ({
				key: check.name,
				value: check,
			})),
		);

		if (
			isEmptyKeyedDiff(columnDiff) &&
			isEmptyKeyedDiff(indexDiff) &&
			isEmptyKeyedDiff(foreignKeyDiff) &&
			isEmptyKeyedDiff(checkDiff)
		) {
			return [];
		}

		const notes = [
			...buildNotes("column", columnDiff),
			...buildNotes("index", indexDiff),
			...buildNotes("foreign key", foreignKeyDiff),
			...buildNotes("check", checkDiff),
		];

		return [
			{ kind: "table", operation: "alter", identity, previous, next, notes },
		];
	},
	emit: (change) => emitTableSql(change),
};
