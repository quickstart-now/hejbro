import type {
	ForeignKeyAction,
	IndexDeclaration,
	IndexNulls,
	TableDeclaration,
} from "../dsl/table";
import type { ExprNode } from "../expr/ast";
import { encodeExprNode } from "../expr/codec";
import type { KeyedDiff } from "../kind/diff-helpers";
import { createOrDropDiff, diffByKey } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import type { ColumnState } from "../types/column-builder";
import type { TypeNode } from "../types/type-node";
import { isSerialTypeNode, serialBaseType } from "../types/type-node";
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

/**
 * Derives a `serial`-family column's backing sequence name from its owning
 * table and column (#23/D66) — matches Postgres's own naming convention
 * exactly (confirmed via `pg_dump`: `serial primary key` on `posts.id`
 * produces `posts_id_seq`). Shared with `engine/rename-plan.ts`'s drift
 * guard, the same way `deriveIndexName`/`deriveForeignKeyName` already
 * are.
 */
export const deriveSequenceName = (
	tableName: string,
	columnName: string,
): string => `${tableName}_${columnName}_seq`;

/**
 * Derives a table's primary key constraint's default name from its owning
 * table (#24/D68) — matches Postgres's own naming convention exactly
 * (confirmed via `pg_dump`: a table's primary key constraint, however
 * declared, is named `<table>_pkey`). Column-name-independent, unlike
 * {@link deriveIndexName}/{@link deriveForeignKeyName} — a column *rename*
 * therefore never changes this name, only a *table* rename does (measured
 * against `pg_dump` output; `engine/rename-plan.ts`'s drift guard for this
 * name only needs to run on the table-rename path as a result). Shared
 * with `engine/rename-plan.ts`'s drift guard, the same way
 * `deriveIndexName`/`deriveForeignKeyName`/`deriveSequenceName` already
 * are.
 */
export const derivePrimaryKeyName = (tableName: string): string =>
	`${tableName}_pkey`;

/**
 * Derives a single-column UNIQUE constraint's default name from its owning
 * table and column (#24/D68) — matches Postgres's own naming convention
 * exactly (confirmed via `pg_dump`: a bare inline `unique` column clause
 * produces `<table>_<column>_key`). Recorded in the snapshot now
 * (`ColumnSnapshot.uniqueName`) so a future UNIQUE-alter feature never has
 * to disagree with a name already committed to a user's database — UNIQUE
 * *emission* itself stays unimplemented this wave (`table-kind-emit.ts`'s
 * `unsupported-column-alter` guard).
 */
export const deriveUniqueName = (
	tableName: string,
	columnName: string,
): string => `${tableName}_${columnName}_key`;

/**
 * `primaryKey` implies `notNull` once a column is materialized into a
 * snapshot -- and so does a `serial`/`smallserial`/`bigserial` type (#23/
 * D66): confirmed against a real Postgres (`pg_dump` on a table declaring
 * `bigserial`/`smallserial` columns with neither `.primaryKey()` nor
 * `.notNull()` chained still showed `NOT NULL` on both) that the
 * pseudo-type sugar itself carries the constraint, independent of
 * primary-key status. None of the three serial factories set `notNull` on
 * their own construction, so without this, a bare `serial()` column would
 * materialize as nullable -- a column a real Postgres would never let
 * exist.
 */
const materializeNotNull = (columnState: ColumnState): boolean => {
	if (columnState.primaryKey) {
		return true;
	}
	if (isSerialTypeNode(columnState.typeNode)) {
		return true;
	}
	return columnState.notNull;
};

/**
 * A `serial`-family pseudo-type materializes into its real, storable base
 * type (#23/D66) — the column's `nextval(...)` default and its backing
 * sequence are tracked entirely by the synthesized `sequence` declaration
 * (`engine/generate.ts`'s `resolveDeclarations`, `kinds/sequence-kind.ts`),
 * never by this column's own `typeNode`/`default`. This is what keeps the
 * invalid `alter column … type serial` path structurally unreachable from
 * `table-kind-emit.ts`'s generic type-alter path — a `ColumnSnapshot`
 * simply never contains the pseudo-type past this point, so there is
 * nothing to guard against at emit time.
 */
const materializeTypeNode = (columnState: ColumnState): TypeNode => {
	if (isSerialTypeNode(columnState.typeNode)) {
		return serialBaseType(columnState.typeNode.typeName);
	}
	return columnState.typeNode;
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

/** `{ uniqueName: derive(...) }` when the column is unique, else `{}` (compact snapshot, #24/D68) — always paired with `columnUniqueField`, never present on its own. */
const uniqueNameField = (
	tableName: string,
	columnName: string,
	unique: boolean,
): Pick<ColumnSnapshot, "uniqueName"> => {
	if (!unique) {
		return {};
	}
	return { uniqueName: deriveUniqueName(tableName, columnName) };
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
		typeNode: materializeTypeNode(entry.columnState),
		...notNullField(materializeNotNull(entry.columnState)),
		...primaryKeyField(entry.columnState.primaryKey),
		...columnUniqueField(entry.columnState.unique),
		...uniqueNameField(
			declaration.tableName,
			entry.columnName,
			entry.columnState.unique,
		),
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

/** `{ primaryKeyName: derive(...) }` when at least one column declares `.primaryKey()`, else `{}` (compact snapshot, #24/D68) — membership itself stays on the columns (`columnPrimaryKey`); this is only the constraint's name, recorded once at table level rather than once per member column. */
const primaryKeyNameField = (
	declaration: TableDeclaration,
): Pick<TableSnapshot, "primaryKeyName"> => {
	const hasPrimaryKey = declaration.columns.some(
		(entry) => entry.columnState.primaryKey,
	);
	if (!hasPrimaryKey) {
		return {};
	}
	return { primaryKeyName: derivePrimaryKeyName(declaration.tableName) };
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
 *
 * `dependsOn` includes `"sequence"` (D74/#23): a serial-family column
 * added to an existing table now inlines `default nextval('…')` straight
 * into its own `add column` statement (`table-kind-emit.ts`'s
 * `sequenceForAddedColumn`), which requires the sequence to already exist
 * — so `table`'s own create/alter statements must sort *after*
 * `sequence`'s. This makes that ordering structural (kind rank, enforced
 * regardless of registry.ts's registration order — see
 * `diff-engine.test.ts`'s pinning test) rather than the incidental
 * by-product it was before this dependency was declared (confirmed
 * directly: without it, only `registry.ts`'s current registration order
 * — sequence before table — happened to produce the right order, and
 * nothing would have caught a future reordering).
 */
export const tableKind: ObjectKind<TableDeclaration> = {
	kind: "table",
	dependsOn: ["schema", "enum", "sequence"],
	owns: (declaration): declaration is TableDeclaration =>
		declaration.declarationKind === "table",
	serialize: (declaration) => ({
		schema: declaration.schema.schemaName,
		name: declaration.tableName,
		columns: serializeColumns(declaration),
		indexes: serializeIndexes(declaration),
		foreignKeys: serializeForeignKeys(declaration),
		...checksField(serializeChecks(declaration)),
		...primaryKeyNameField(declaration),
	}),
	identify: (snapshot) => {
		const tableSnapshot = asTableSnapshot(snapshot);
		return tableIdentity(tableSnapshot.schema, tableSnapshot.name);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("table", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}

		const previousSnapshot = asTableSnapshot(guard.previous);
		const nextSnapshot = asTableSnapshot(guard.next);

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
			{
				kind: "table",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes,
			},
		];
	},
	emit: (change, siblingChanges, nextSnapshot) =>
		emitTableSql(change, siblingChanges, nextSnapshot),
};
