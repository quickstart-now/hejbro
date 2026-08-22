import { throwHejbroError } from "../error";
import type { KeyedDiff } from "../kind/diff-helpers";
import { diffByKey, sameJson } from "../kind/diff-helpers";
import { dispatchEmit } from "../kind/emit-helpers";
import type { KindChange } from "../kind/object-kind";
import { compareKeys } from "../sort";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import {
	deferredStatement,
	predropStatement,
	statement,
} from "../sql/statement";
import type { TypeNode } from "../types/type-node";
import { renderTypeNode } from "../types/type-node";
import type { SequenceSnapshot } from "./sequence-kind";
import { asSequenceSnapshot, nextvalExpression } from "./sequence-kind";
import {
	addCheckConstraintSql,
	addForeignKeyConstraintSql,
	addPrimaryKeyConstraintSql,
	createIndexSql,
	createTableSql,
	dropConstraintSql,
	renderColumnDefinition,
} from "./table-kind-emit-sql";
import type { ColumnSnapshot, TableSnapshot } from "./table-snapshot";
import {
	asTableSnapshot,
	columnDefault,
	columnNotNull,
	columnPrimaryKey,
	columnUnique,
	tableChecks,
	tablePrimaryKeyName,
} from "./table-snapshot";

/**
 * The sibling `sequence` "create" change (D74) whose owning `schema`/
 * `table`/`column` matches this added column, or `null` if none — a
 * serial-family column added to an *existing* table (#23) needs its
 * default inlined into the same `add column` statement (see
 * `emitAlter`'s own use below), because the default lives in the
 * sequence's own snapshot node, never `ColumnSnapshot.default`.
 */
const sequenceForAddedColumn = (
	schema: string,
	tableName: string,
	columnName: string,
	siblingChanges: ReadonlyArray<KindChange>,
): SequenceSnapshot | null => {
	const candidates = siblingChanges
		.filter(
			(sibling) =>
				sibling.kind === "sequence" &&
				sibling.operation === "create" &&
				sibling.next !== null,
		)
		.map((sibling) => asSequenceSnapshot(sibling.next));
	const match = candidates.find(
		(sequence) =>
			sequence.schema === schema &&
			sequence.table === tableName &&
			sequence.column === columnName,
	);
	return match ?? null;
};

/** #23: a serial-family column added to an existing table inlines its
 * sequence-backed default into the same `add column` statement -- see
 * {@link sequenceForAddedColumn}'s doc comment. `sequence === null` is
 * every other added column (the vast majority), unaffected. */
const overrideDefaultForAddedColumn = (
	sequence: SequenceSnapshot | null,
): string | undefined => {
	if (sequence === null) {
		return undefined;
	}
	return nextvalExpression(sequence);
};

const emitCreate = (next: TableSnapshot): ReadonlyArray<SqlStatement> => [
	statement(createTableSql(next)),
	...next.indexes.map((index) =>
		statement(createIndexSql(next.schema, next.name, index)),
	),
	...next.foreignKeys.map((foreignKey) =>
		deferredStatement(
			addForeignKeyConstraintSql(next.schema, next.name, foreignKey),
		),
	),
];

const emitDrop = (previous: TableSnapshot): ReadonlyArray<SqlStatement> => [
	statement(`drop table ${qualifyName(previous.schema, previous.name)};`),
];

const typeAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextTypeNode: TypeNode,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} type ${renderTypeNode(nextTypeNode)};`,
		),
	];
};

const notNullAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextNotNull: boolean,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	if (nextNotNull) {
		return [
			statement(
				`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set not null;`,
			),
		];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop not null;`,
		),
	];
};

const defaultAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextDefault: string | null,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	if (nextDefault === null) {
		return [
			statement(
				`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop default;`,
			),
		];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set default ${nextDefault};`,
		),
	];
};

const alterColumnStatements = (
	schema: string,
	tableName: string,
	entry: {
		readonly key: string;
		readonly previous: ColumnSnapshot;
		readonly next: ColumnSnapshot;
	},
): ReadonlyArray<SqlStatement> => {
	const typeChanged = !sameJson(entry.previous.typeNode, entry.next.typeNode);
	const notNullChanged =
		columnNotNull(entry.previous) !== columnNotNull(entry.next);
	const defaultChanged = !sameJson(
		columnDefault(entry.previous),
		columnDefault(entry.next),
	);
	const uniqueChanged =
		columnUnique(entry.previous) !== columnUnique(entry.next);
	// A column's own primaryKey flag flipping (with the column itself
	// neither added nor dropped) used to be its own guard here
	// (throwHejbroError, unsupported-column-alter) — #24 folds it into
	// emitAlter's single table-wide `primaryKeyColumnsChanged` check
	// instead (see there), the same rule that now also handles a PK
	// column being added or a composite PK's partial drop. All three used
	// to be three separate special cases; they're one column-set diff.

	if (uniqueChanged) {
		return throwHejbroError(
			"unsupported-column-alter",
			`column "${entry.key}" on table "${tableName}" changed its unique flag — hejbro does not emit sql for that. Next: add/drop the column, or add/drop a unique constraint manually.`,
		);
	}

	return [
		...typeAlterStatements(
			schema,
			tableName,
			entry.key,
			typeChanged,
			entry.next.typeNode,
		),
		...notNullAlterStatements(
			schema,
			tableName,
			entry.key,
			notNullChanged,
			columnNotNull(entry.next),
		),
		...defaultAlterStatements(
			schema,
			tableName,
			entry.key,
			defaultChanged,
			columnDefault(entry.next),
		),
	];
};

/** `snapshot`'s primary-key column names, in declared order (membership lives on the columns, `columnPrimaryKey` — #24, table-snapshot.ts's own doc comment). */
const primaryKeyColumnNames = (
	snapshot: TableSnapshot,
): ReadonlyArray<string> =>
	snapshot.columns
		.filter((column) => columnPrimaryKey(column))
		.map((column) => column.name);

type PrimaryKeyChange = {
	readonly dropStatement: SqlStatement | null;
	readonly addStatement: SqlStatement | null;
};

const NO_PRIMARY_KEY_CHANGE: PrimaryKeyChange = {
	dropStatement: null,
	addStatement: null,
};

/** `[]` for `null`, `[maybeStatement]` otherwise — lets `emitAlter`'s return array `...spread` a possibly-absent statement the same way it spreads every array-sourced one. */
const statementOrEmpty = (
	maybeStatement: SqlStatement | null,
): ReadonlyArray<SqlStatement> => {
	if (maybeStatement === null) {
		return [];
	}
	return [maybeStatement];
};

/**
 * Plans the primary key's `drop constraint`/`add constraint` statements
 * for one `alter` (#24, replacing #137's three separate guards —
 * `alterColumnStatements`'s per-column flag check, and `emitAlter`'s own
 * added/composite-partial-drop checks — with one column-*set* diff. A PK
 * column added or dropped as a column, and an existing column's
 * `.primaryKey()` flag flipping in place, all show up here identically:
 * as a difference between `previousPkColumns` and `nextPkColumns`.
 *
 * - Unchanged column set (as a set — order doesn't matter, matching
 *   "column reordering alone produces no diff" elsewhere in this kind):
 *   no statements.
 * - Changed, and every one of `previousPkColumns` is itself being
 *   dropped as a column (`columnDiff.removed`): Postgres already cascades
 *   the whole constraint away the moment any of its member columns is
 *   dropped, so no explicit `drop constraint` is emitted — this is the
 *   pre-#24 "single-column primary key dropped entirely" case, generalized
 *   to "every member column dropped." `addStatement` still fires if
 *   `nextPkColumns` is non-empty (a fresh PK naming different columns).
 * - Changed, and *not* every previous member column is being dropped
 *   (the #137 hazard: a composite PK's *partial* drop, or a flag flip on
 *   a column that isn't being dropped at all): the constraint would
 *   otherwise be silently gone (partial drop) or wrongly still present
 *   (flag flip with no column event to cascade from) — emitted
 *   explicitly instead of relying on cascade timing either way:
 *   `drop constraint` (if `previous` had one) then `add constraint` (if
 *   `next` wants one), covering add/drop/rename-by-reshuffle uniformly.
 *
 * Statement placement (`emitAlter`): `dropStatement` sorts with the other
 * drops, *before* `columnDiff.removed`'s `drop column` statements (the
 * constraint must be gone, or never touched, before its member column is
 * — dropping the column first, when we *are* emitting an explicit drop,
 * would either double-drop or hit a since-cascaded constraint that no
 * longer exists). `addStatement` sorts with the other adds, after
 * `columnDiff.added`'s `add column` statements (a new member column must
 * exist before the constraint can name it).
 */
/** `planPrimaryKeyChange`'s drop half — `null` unless `previous` had a named constraint that Postgres won't already have cascaded away on its own (`everyPreviousMemberWasDropped`). */
const primaryKeyDropStatement = (
	previous: TableSnapshot,
	next: TableSnapshot,
	everyPreviousMemberWasDropped: boolean,
): SqlStatement | null => {
	const previousConstraintName = tablePrimaryKeyName(previous);
	if (previousConstraintName === null || everyPreviousMemberWasDropped) {
		return null;
	}
	return statement(
		dropConstraintSql(next.schema, next.name, previousConstraintName),
	);
};

/** `planPrimaryKeyChange`'s add half — `null` unless `next` wants a primary key at all. */
const primaryKeyAddStatement = (
	next: TableSnapshot,
	nextPkColumns: ReadonlyArray<string>,
): SqlStatement | null => {
	const nextConstraintName = tablePrimaryKeyName(next);
	if (nextConstraintName === null || nextPkColumns.length === 0) {
		return null;
	}
	return statement(
		addPrimaryKeyConstraintSql(
			next.schema,
			next.name,
			nextConstraintName,
			nextPkColumns,
		),
	);
};

const planPrimaryKeyChange = (
	previous: TableSnapshot,
	next: TableSnapshot,
	columnDiff: KeyedDiff<ColumnSnapshot>,
): PrimaryKeyChange => {
	const previousPkColumns = primaryKeyColumnNames(previous);
	const nextPkColumns = primaryKeyColumnNames(next);
	const columnSetChanged = !sameJson(
		[...previousPkColumns].sort(compareKeys),
		[...nextPkColumns].sort(compareKeys),
	);
	if (!columnSetChanged) {
		return NO_PRIMARY_KEY_CHANGE;
	}

	const droppedColumnNames = new Set(
		columnDiff.removed.map((entry) => entry.key),
	);
	const everyPreviousMemberWasDropped =
		previousPkColumns.length > 0 &&
		previousPkColumns.every((name) => droppedColumnNames.has(name));

	return {
		dropStatement: primaryKeyDropStatement(
			previous,
			next,
			everyPreviousMemberWasDropped,
		),
		addStatement: primaryKeyAddStatement(next, nextPkColumns),
	};
};

const emitAlter = (
	previous: TableSnapshot,
	next: TableSnapshot,
	siblingChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<SqlStatement> => {
	const columnDiff = diffByKey(
		previous.columns.map((column) => ({ key: column.name, value: column })),
		next.columns.map((column) => ({ key: column.name, value: column })),
	);
	const indexDiff = diffByKey(
		previous.indexes.map((index) => ({ key: index.name, value: index })),
		next.indexes.map((index) => ({ key: index.name, value: index })),
	);
	const foreignKeyDiff = diffByKey(
		previous.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
		next.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
	);
	const checkDiff = diffByKey(
		tableChecks(previous).map((check) => ({ key: check.name, value: check })),
		tableChecks(next).map((check) => ({ key: check.name, value: check })),
	);

	const primaryKeyChange = planPrimaryKeyChange(previous, next, columnDiff);

	const foreignKeysToDrop = [
		...foreignKeyDiff.removed.map((entry) => entry.key),
		...foreignKeyDiff.changed.map((entry) => entry.key),
	];
	const foreignKeysToAdd = [
		...foreignKeyDiff.added.map((entry) => entry.value),
		...foreignKeyDiff.changed.map((entry) => entry.next),
	];
	const checksToDrop = [
		...checkDiff.removed.map((entry) => entry.key),
		...checkDiff.changed.map((entry) => entry.key),
	];
	const checksToAdd = [
		...checkDiff.added.map((entry) => entry.value),
		...checkDiff.changed.map((entry) => entry.next),
	];
	const indexesToDrop = [
		...indexDiff.removed.map((entry) => entry.key),
		...indexDiff.changed.map((entry) => entry.key),
	];
	const indexesToAdd = [
		...indexDiff.added.map((entry) => entry.value),
		...indexDiff.changed.map((entry) => entry.next),
	];

	return [
		// A cross-table FK can reference a column another table alter in this
		// same run is about to drop — both are `table` kind, same rank, so the
		// referenced table can sort after the referencing one by identity
		// alone. hejbro already sends FK *adds* out on `deferred` (last);
		// sending FK *drops* out on `predrop` (first) is the mirror image —
		// edges are cut first and wired last (#122/A′). CHECK constraints
		// share `dropConstraintSql` but never cross a table boundary, so their
		// drop stays in `main` — already-safe via this function's own
		// statement order (drops before the column/table changes below).
		...foreignKeysToDrop.map((name) =>
			predropStatement(dropConstraintSql(next.schema, next.name, name)),
		),
		...checksToDrop.map((name) =>
			statement(dropConstraintSql(next.schema, next.name, name)),
		),
		...indexesToDrop.map((name) =>
			statement(`drop index ${qualifyName(next.schema, name)};`),
		),
		// Ahead of columnDiff.removed's own `drop column` statements below —
		// see planPrimaryKeyChange's doc comment for why the ordering matters
		// whenever this fires an explicit drop.
		...statementOrEmpty(primaryKeyChange.dropStatement),
		...columnDiff.removed.map((entry) =>
			statement(
				`alter table ${qualifyName(next.schema, next.name)} drop column ${quoteIdentifier(entry.key)};`,
			),
		),
		...columnDiff.added.map((entry) => {
			const sequence = sequenceForAddedColumn(
				next.schema,
				next.name,
				entry.key,
				siblingChanges,
			);
			const overrideDefault = overrideDefaultForAddedColumn(sequence);
			return statement(
				`alter table ${qualifyName(next.schema, next.name)} add column ${renderColumnDefinition(entry.value, overrideDefault)};`,
			);
		}),
		...columnDiff.changed.flatMap((entry) =>
			alterColumnStatements(next.schema, next.name, entry),
		),
		// After every column add/change above — a new or reshuffled member
		// column must already exist before the constraint can name it.
		...statementOrEmpty(primaryKeyChange.addStatement),
		...indexesToAdd.map((index) =>
			statement(createIndexSql(next.schema, next.name, index)),
		),
		...checksToAdd.map((check) =>
			statement(addCheckConstraintSql(next.schema, next.name, check)),
		),
		...foreignKeysToAdd.map((foreignKey) =>
			deferredStatement(
				addForeignKeyConstraintSql(next.schema, next.name, foreignKey),
			),
		),
	];
};

const emitCreateChange = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"table create change is missing its next snapshot.",
		);
	}
	return emitCreate(asTableSnapshot(change.next));
};

const emitDropChange = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"table drop change is missing its previous snapshot.",
		);
	}
	return emitDrop(asTableSnapshot(change.previous));
};

const emitAlterChange = (
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<SqlStatement> => {
	if (change.previous === null || change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"table alter change is missing its previous or next snapshot.",
		);
	}
	return emitAlter(
		asTableSnapshot(change.previous),
		asTableSnapshot(change.next),
		siblingChanges,
	);
};

/**
 * Emits SQL for a table {@link KindChange}: `create table` (+ indexes +
 * deferred FK constraints) for creates, `drop table` for drops, and
 * targeted `alter table` statements for survivors — a dropped FK goes out
 * on `predrop` (#122/A′), everything else in `main`. `siblingChanges`
 * (D74) is only used by the `alter` case's `columnDiff.added` rendering,
 * to inline a serial-family added column's sequence-backed default (#23)
 * — see `sequenceForAddedColumn`'s doc comment.
 */
export const emitTableSql = (
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange> = [],
): ReadonlyArray<SqlStatement> =>
	dispatchEmit(
		{
			create: emitCreateChange,
			alter: emitAlterChange,
			drop: emitDropChange,
		},
		change,
		siblingChanges,
	);
