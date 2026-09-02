import type {
	ForeignKeyAction,
	IndexColumnDeclaration,
	IndexDeclaration,
	IndexMethod,
	IndexNulls,
	TableDeclaration,
} from "../dsl/table";
import type { ExprNode } from "../expr/ast";
import { encodeExprNode } from "../expr/codec";
import type { KeyedDiff } from "../kind/diff-helpers";
import { createOrDropDiff, diffByKey } from "../kind/diff-helpers";
import type { ObjectKind, SerializeContext } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import type {
	ColumnState,
	IdentityKind,
	IdentityState,
} from "../types/column-builder";
import type { TypeNode } from "../types/type-node";
import { isSerialTypeNode, serialBaseType } from "../types/type-node";
import { emitTableSql } from "./table-kind-emit";
import type {
	CheckSnapshot,
	ColumnSnapshot,
	ForeignKeySnapshot,
	IdentitySnapshot,
	IndexColumnSnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "./table-snapshot";
import {
	asTableSnapshot,
	tableChecks,
	tableIdentity,
	tableUnmanaged,
} from "./table-snapshot";

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
 * `primaryKey`, a `serial`/`smallserial`/`bigserial` type (#23/D66,
 * confirmed against `pg_dump`), and an identity (D100, not yet
 * witnessed — group 4; both kinds alike) all imply `notNull` once a
 * column is materialized into a snapshot, even when the declaration
 * itself never called `.notNull()`.
 */
const materializeNotNull = (columnState: ColumnState): boolean => {
	if (columnState.primaryKey) {
		return true;
	}
	if (isSerialTypeNode(columnState.typeNode)) {
		return true;
	}
	// Every identity column is NOT NULL by Postgres rule, both kinds alike.
	if (columnState.identity !== undefined) {
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

/**
 * The `name` entries' names, in order — an expression entry (R5) names no
 * column of its own and is retargeted on rename, not renamed by name, so
 * it contributes nothing to derived-name recomputation (R7/R10b). Generic
 * over both `IndexColumnDeclaration` (`dsl/table.ts`) and
 * `IndexColumnSnapshot` (`table-snapshot.ts`) — they share this shape —
 * so `dsl/table.ts`'s own validation and `engine/rename-plan.ts`'s rename
 * plumbing both import this one implementation instead of each keeping
 * their own copy (the same "shared with engine/rename-plan.ts" relationship
 * {@link deriveIndexName} already has).
 */
export const namedIndexColumnNames = (
	columns: ReadonlyArray<
		{ readonly name: string } | { readonly expression: unknown }
	>,
): ReadonlyArray<string> =>
	columns.flatMap((column) => {
		if ("name" in column) {
			return [column.name];
		}
		return [];
	});

const resolveIndexName = (
	tableName: string,
	index: IndexDeclaration,
): string => {
	if (index.indexName !== null) {
		return index.indexName;
	}
	return deriveIndexName(tableName, namedIndexColumnNames(index.columns));
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

/** Encodes a `.generatedAlwaysAs(...)` column's own expression into its snapshot form (D100), mirroring {@link encodeColumnDefaultExpr} — `null` when the column isn't generated. */
const encodeColumnGeneratedExpr = (
	columnState: ColumnState,
): JsonValue | null => {
	if (columnState.generated === undefined) {
		return null;
	}
	return encodeExprNode(columnState.generated);
};

/**
 * `columnState.identity.kind`'s camelCase→kebab map for the snapshot
 * boundary (D57/D100) — table-kind-local, mirroring `expr/codec.ts`'s
 * `NODE_KIND_TO_SNAPSHOT` precedent (`"all-columns"`), since this token
 * has nothing to do with the expression codec.
 */
const IDENTITY_KIND_TO_SNAPSHOT: Readonly<
	Record<IdentityKind, IdentitySnapshot["kind"]>
> = {
	always: "always",
	byDefault: "by-default",
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

/** `{ generated: <node> }` when the column is a stored computed column, else `{}` (compact snapshot, D100) — mirrors {@link defaultField}. */
const generatedField = (
	value: JsonValue | null,
): Pick<ColumnSnapshot, "generated"> => {
	if (value === null) {
		return {};
	}
	return { generated: value };
};

/**
 * `{ identity: { kind, ...options } }` when the column declares an
 * identity, else `{}` (compact snapshot, D100). `options` is spread
 * as-is: `columnState.identity.options` already carries exactly the keys
 * the declaration set (`IdentityOptions`' own optional fields, built by
 * the `generatedAlwaysAsIdentity`/`generatedByDefaultAsIdentity`
 * factories) — declaration-is-truth, never filled in with a Postgres
 * default the declaration never mentioned (design decision 3).
 */
const identityField = (
	identity: IdentityState | undefined,
): Pick<ColumnSnapshot, "identity"> => {
	if (identity === undefined) {
		return {};
	}
	return {
		identity: {
			kind: IDENTITY_KIND_TO_SNAPSHOT[identity.kind],
			...identity.options,
		},
	};
};

/** @see notNullField */
const indexUniqueField = (value: boolean): Pick<IndexSnapshot, "unique"> => {
	if (!value) {
		return {};
	}
	return { unique: true };
};

/** `{ method: <method> }` for a non-btree access method, else `{}` (compact snapshot — `btree`, Postgres' own default, is never recorded, SC-004). */
const methodField = (
	value: IndexMethod | null,
): Pick<IndexSnapshot, "method"> => {
	if (value === null || value === "btree") {
		return {};
	}
	return { method: value };
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

/** `{ opclass: <class> }` when set, else `{}` (compact snapshot). */
const indexColumnOpclassField = (
	value: string | null,
): Pick<IndexColumnSnapshot, "opclass"> => {
	if (value === null) {
		return {};
	}
	return { opclass: value };
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

/** D81: `order`'s columns, in `order`'s order — a name `order` carries that `columns` doesn't is skipped (defensive only: the oracle's order is always exactly this table's declared names). `order === null` (no parent, e.g. a table new to this build) keeps declaration order. */
const orderByOracle = (
	columns: ReadonlyArray<ColumnSnapshot>,
	order: ReadonlyArray<string> | null,
): ReadonlyArray<ColumnSnapshot> => {
	if (order === null) {
		return columns;
	}
	const byName = new Map(columns.map((column) => [column.name, column]));
	return order.flatMap((name) => {
		const column = byName.get(name);
		if (column === undefined) {
			return [];
		}
		return [column];
	});
};

const serializeColumns = (
	declaration: TableDeclaration,
	context?: SerializeContext,
): ReadonlyArray<ColumnSnapshot> =>
	orderByOracle(
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
			...generatedField(encodeColumnGeneratedExpr(entry.columnState)),
			...identityField(entry.columnState.identity),
		})),
		context?.columnOrder({
			schemaName: declaration.schema.schemaName,
			tableName: declaration.tableName,
		}) ?? null,
	);

/** `{ name }` for a plain-column entry, `{ expression: encodeExprNode(...) }` for an expression entry (R5/R8) — the two-variant column's own field. */
const serializeIndexColumnSelf = (
	column: IndexColumnDeclaration,
): { readonly name: string } | { readonly expression: JsonValue } => {
	if ("name" in column) {
		return { name: column.name };
	}
	return { expression: encodeExprNode(column.expression) };
};

const serializeIndexColumn = (
	column: IndexColumnDeclaration,
): IndexColumnSnapshot => ({
	...serializeIndexColumnSelf(column),
	...indexColumnDescField(column.desc),
	...indexColumnNullsField(column.nulls),
	...indexColumnOpclassField(column.opclass),
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
		...methodField(index.method),
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

/** `{ unmanaged: true }` for an `existingTable()` declaration, else `{}` (compact snapshot, add-unmanaged-objects) — sourced from `declaration.existing`, the same flag `existingTable()` already sets. */
const unmanagedField = (
	declaration: TableDeclaration,
): Pick<TableSnapshot, "unmanaged"> => {
	if (!declaration.existing) {
		return {};
	}
	return { unmanaged: true };
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

/** The four keyed diffs a survivor-to-survivor table `diff` compares — one per field a table alter can touch (#154 ratchet-5: split out of tableKind.diff so computing them reads as its own step, separate from what they're used for). */
type TableFieldDiffs = {
	readonly columnDiff: KeyedDiff<ColumnSnapshot>;
	readonly indexDiff: KeyedDiff<IndexSnapshot>;
	readonly foreignKeyDiff: KeyedDiff<ForeignKeySnapshot>;
	readonly checkDiff: KeyedDiff<CheckSnapshot>;
};

const tableFieldDiffs = (
	previousSnapshot: TableSnapshot,
	nextSnapshot: TableSnapshot,
): TableFieldDiffs => ({
	columnDiff: diffByKey(
		previousSnapshot.columns.map((column) => ({
			key: column.name,
			value: column,
		})),
		nextSnapshot.columns.map((column) => ({
			key: column.name,
			value: column,
		})),
	),
	indexDiff: diffByKey(
		previousSnapshot.indexes.map((index) => ({
			key: index.name,
			value: index,
		})),
		nextSnapshot.indexes.map((index) => ({ key: index.name, value: index })),
	),
	foreignKeyDiff: diffByKey(
		previousSnapshot.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
		nextSnapshot.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
	),
	checkDiff: diffByKey(
		tableChecks(previousSnapshot).map((check) => ({
			key: check.name,
			value: check,
		})),
		tableChecks(nextSnapshot).map((check) => ({
			key: check.name,
			value: check,
		})),
	),
});

/** `true` when none of `diffs`' four fields changed at all — a survivor whose columns/indexes/foreign keys/checks are all byte-identical produces no alter change (#154 ratchet-5, see tableFieldDiffs). */
const isEmptyTableFieldDiffs = (diffs: TableFieldDiffs): boolean =>
	isEmptyKeyedDiff(diffs.columnDiff) &&
	isEmptyKeyedDiff(diffs.indexDiff) &&
	isEmptyKeyedDiff(diffs.foreignKeyDiff) &&
	isEmptyKeyedDiff(diffs.checkDiff);

/** `true` when `node` is a table snapshot node marked unmanaged — `null` (the table absent on that side) is never unmanaged (add-unmanaged-objects). The DDL-blocking guard `tableKind.diff` opens with: an unmanaged table on *either* side of a diff emits nothing, before create/drop/alter is even considered. */
const isUnmanagedSide = (node: JsonValue | null): boolean =>
	node !== null && tableUnmanaged(asTableSnapshot(node));

/** One banner note per added/dropped/changed entry across all four of `diffs`' fields (#154 ratchet-5, see tableFieldDiffs). */
const tableFieldDiffNotes = (diffs: TableFieldDiffs): ReadonlyArray<string> => [
	...buildNotes("column", diffs.columnDiff),
	...buildNotes("index", diffs.indexDiff),
	...buildNotes("foreign key", diffs.foreignKeyDiff),
	...buildNotes("check", diffs.checkDiff),
];

/**
 * The built-in object kind for Postgres tables. Identity is
 * `"<schema>.<tableName>"`. `diff` reports one `create`/`drop` change for
 * whole tables, and a single `alter` change (notes listing every column,
 * index, and foreign key delta) for survivors — column reordering alone
 * produces no diff, since deltas are computed by name, not by array index.
 *
 * `columns`' order in the snapshot this `serialize` produces is the
 * table's *physical* column order (D81), not TypeScript declaration
 * order: `context?.columnOrder` — the oracle `buildSnapshot` derives from
 * the parent snapshot — decides it, falling back to declaration order
 * when the oracle has no opinion (a table new to this build, or no
 * context at all). The diff stays name-keyed either way.
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
	requiredKeys: ["schema", "name", "columns", "indexes", "foreignKeys"],
	owns: (declaration): declaration is TableDeclaration =>
		declaration.declarationKind === "table",
	serialize: (declaration, context) => ({
		schema: declaration.schema.schemaName,
		name: declaration.tableName,
		columns: serializeColumns(declaration, context),
		indexes: serializeIndexes(declaration),
		foreignKeys: serializeForeignKeys(declaration),
		...checksField(serializeChecks(declaration)),
		...primaryKeyNameField(declaration),
		...unmanagedField(declaration),
	}),
	identify: (snapshot) => {
		const tableSnapshot = asTableSnapshot(snapshot);
		return tableIdentity(tableSnapshot.schema, tableSnapshot.name);
	},
	diff: (previous, next, identity) => {
		if (isUnmanagedSide(previous) || isUnmanagedSide(next)) {
			return [];
		}
		const guard = createOrDropDiff("table", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}

		const diffs = tableFieldDiffs(
			asTableSnapshot(guard.previous),
			asTableSnapshot(guard.next),
		);
		if (isEmptyTableFieldDiffs(diffs)) {
			return [];
		}

		return [
			{
				kind: "table",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: tableFieldDiffNotes(diffs),
			},
		];
	},
	emit: (change, siblingChanges, nextSnapshot) =>
		emitTableSql(change, siblingChanges, nextSnapshot),
};
