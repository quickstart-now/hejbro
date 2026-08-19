import type {
	ForeignKeyAction,
	IndexDeclaration,
	TableDeclaration,
} from "../dsl/table";
import { throwHejbroError } from "../error";
import type { KeyedDiff } from "../kind/diff-helpers";
import { diffByKey } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import type { ColumnDefault, ColumnState } from "../types/column-builder";
import type { TypeNode } from "../types/type-node";

type ColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly default: ColumnDefault | null;
};

type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly unique: boolean;
};

type ForeignKeySnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesTable: string;
	readonly referencesColumns: ReadonlyArray<string>;
	readonly onDelete: ForeignKeyAction | null;
};

type TableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<ColumnSnapshot>;
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
};

// Internal invariant: this shape is exactly what tableKind.serialize below produces.
const asTableSnapshot = (snapshot: JsonValue): TableSnapshot =>
	snapshot as TableSnapshot;

const tableIdentity = (schemaName: string, tableName: string): string =>
	`${schemaName}.${tableName}`;

const deriveIndexName = (
	tableName: string,
	columns: ReadonlyArray<string>,
): string => `${tableName}_${columns.join("_")}_idx`;

const deriveForeignKeyName = (
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
	return deriveIndexName(tableName, index.columns);
};

const serializeColumns = (
	declaration: TableDeclaration,
): ReadonlyArray<ColumnSnapshot> =>
	declaration.columns.map((entry) => ({
		name: entry.columnName,
		typeNode: entry.columnState.typeNode,
		notNull: materializeNotNull(entry.columnState),
		primaryKey: entry.columnState.primaryKey,
		unique: entry.columnState.unique,
		default: entry.columnState.defaultValue,
	}));

const serializeIndexes = (
	declaration: TableDeclaration,
): ReadonlyArray<IndexSnapshot> =>
	declaration.indexes.map((index) => ({
		name: resolveIndexName(declaration.tableName, index),
		columns: index.columns,
		unique: index.unique,
	}));

const serializeForeignKeys = (
	declaration: TableDeclaration,
): ReadonlyArray<ForeignKeySnapshot> =>
	declaration.foreignKeys.map((foreignKey) => ({
		name: deriveForeignKeyName(declaration.tableName, foreignKey.columns),
		columns: foreignKey.columns,
		referencesTable: tableIdentity(
			foreignKey.references.table.schema.schemaName,
			foreignKey.references.table.tableName,
		),
		referencesColumns: foreignKey.references.columns,
		onDelete: foreignKey.onDelete,
	}));

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

		if (
			isEmptyKeyedDiff(columnDiff) &&
			isEmptyKeyedDiff(indexDiff) &&
			isEmptyKeyedDiff(foreignKeyDiff)
		) {
			return [];
		}

		const notes = [
			...buildNotes("column", columnDiff),
			...buildNotes("index", indexDiff),
			...buildNotes("foreign key", foreignKeyDiff),
		];

		return [
			{ kind: "table", operation: "alter", identity, previous, next, notes },
		];
	},
	emit: () =>
		throwHejbroError(
			"not-implemented",
			"table kind sql emission lands in Task 11 (table-kind-emit.ts) — this Task 10 placeholder always throws.",
		),
};
