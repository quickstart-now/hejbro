import { throwHejbroError } from "../error";
import type { KeyedDiff } from "../kind/diff-helpers";
import { diffByKey, sameJson } from "../kind/diff-helpers";
import {
	dispatchEmit,
	requireBoth,
	requireNext,
	requirePrevious,
} from "../kind/emit-helpers";
import type { KindChange } from "../kind/object-kind";
import type { Snapshot } from "../snapshot/snapshot";
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
import {
	grantIdentity,
	renderGrantStatement,
	standingAllTablesGrants,
} from "./grant-kind";
import type { SequenceSnapshot } from "./sequence-kind";
import { asSequenceSnapshot, nextvalExpression } from "./sequence-kind";
import {
	addCheckConstraintSql,
	addForeignKeyConstraintSql,
	addPrimaryKeyConstraintSql,
	createIndexSql,
	createTableSql,
	dropConstraintSql,
	IDENTITY_KIND_KEYWORD,
	IDENTITY_OPTION_KEYS,
	renderColumnDefinition,
	renderIdentityOptionToken,
	renderIdentityPhrase,
} from "./table-kind-emit-sql";
import type {
	ColumnSnapshot,
	IdentitySnapshot,
	TableSnapshot,
} from "./table-snapshot";
import {
	asTableSnapshot,
	columnDefault,
	columnGenerated,
	columnIdentity,
	columnNotNull,
	columnPrimaryKey,
	columnUnique,
	tableChecks,
	tablePrimaryKeyName,
} from "./table-snapshot";

/** A sibling change that is itself a `sequence` "create" (D74) — the only shape `sequenceForAddedColumn` can borrow a snapshot from (#154 ratchet-5: named separately from the column-match test below so each reads as its own rule). */
const isMatchingSequenceCreate = (sibling: KindChange): boolean =>
	sibling.kind === "sequence" &&
	sibling.operation === "create" &&
	sibling.next !== null;

/** `true` when `sequence` is the owning sequence for `schema`.`table`.`column` (#154 ratchet-5, see isMatchingSequenceCreate). */
const sequenceOwnsColumn = (
	sequence: SequenceSnapshot,
	schema: string,
	tableName: string,
	columnName: string,
): boolean =>
	sequence.schema === schema &&
	sequence.table === tableName &&
	sequence.column === columnName;

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
		.filter(isMatchingSequenceCreate)
		.map((sibling) => asSequenceSnapshot(sibling.next));
	const match = candidates.find((sequence) =>
		sequenceOwnsColumn(sequence, schema, tableName, columnName),
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

/**
 * Re-issues (verbatim, `renderGrantStatement`) every *standing*
 * `all-tables-privileges` grant already declared for `next`'s schema
 * (#121/D78) — "standing" excludes a grant that's *also* being newly
 * created in this same diff (`siblingChanges` already carries a matching
 * `grant` "create", D74): that grant's own `create` emit already covers
 * this table via `on all tables in schema`, so re-issuing it here too
 * would be a harmless but confusing duplicate statement in the table's
 * *first-ever* migration. Deliberately the *schema-wide* statement again
 * (not a hand-rolled `grant ... on table ...`) — see `renderGrantStatement`'s
 * own doc comment for why a table-scoped rewrite isn't equivalent for a
 * real `pg_dump` comparison even though it produces the same catalog
 * privileges. `nextSnapshot` is `undefined` only when a caller invokes
 * `emitTableSql` without it (no in-repo caller does; kept optional to
 * match `emit`'s own optional third parameter), in which case this table
 * is silently ungranted the same way it always was before #121, rather
 * than throwing.
 */
const standingGrantStatements = (
	next: TableSnapshot,
	nextSnapshot: Snapshot | undefined,
	siblingChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<SqlStatement> => {
	if (nextSnapshot === undefined) {
		return [];
	}
	const newlyCreatedGrantIdentities = new Set(
		siblingChanges
			.filter(
				(sibling) => sibling.kind === "grant" && sibling.operation === "create",
			)
			.map((sibling) => sibling.identity),
	);
	return standingAllTablesGrants(next.schema, nextSnapshot)
		.filter(
			(grant) =>
				!newlyCreatedGrantIdentities.has(
					grantIdentity(grant.schema, grant.grantKind, grant.role),
				),
		)
		.map((grant) =>
			statement(
				renderGrantStatement(
					"all-tables-privileges",
					next.schema,
					grant.role,
					grant.privileges,
				),
			),
		);
};

const emitCreate = (
	next: TableSnapshot,
	nextSnapshot: Snapshot | undefined,
	siblingChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<SqlStatement> => [
	statement(createTableSql(next)),
	...next.indexes.map((index) =>
		statement(createIndexSql(next.schema, next.name, index)),
	),
	...next.foreignKeys.map((foreignKey) =>
		deferredStatement(
			addForeignKeyConstraintSql(next.schema, next.name, foreignKey),
		),
	),
	...standingGrantStatements(next, nextSnapshot, siblingChanges),
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

/**
 * `true` only when both `previous`/`next` already declare a stored
 * generated expression and its rendered text differs — a plain column, or
 * a column newly becoming generated, is never this case. Text-compared via
 * {@link columnGenerated} (decode + render), mirroring how `defaultChanged`
 * already compares `columnDefault`'s rendered text rather than the raw
 * encoded node.
 */
const generatedExpressionChanged = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): boolean => {
	const previousGenerated = columnGenerated(previous);
	const nextGenerated = columnGenerated(next);
	return (
		previousGenerated !== null &&
		nextGenerated !== null &&
		previousGenerated !== nextGenerated
	);
};

/** `true` when `previous` was a stored generated column and `next` is a plain one — the in-place `drop expression` path (PG13+ grammar). */
const generatedRemoved = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): boolean =>
	columnGenerated(previous) !== null && columnGenerated(next) === null;

/**
 * An expression change is a full column rebuild — Postgres has no in-place
 * `alter column ... set expression` (PG18-only grammar, a documented
 * non-goal), so this drops the column and re-adds it with its NEXT
 * definition, verbatim via {@link renderColumnDefinition} — which already
 * renders every other clause (not null, default, unique), so a
 * simultaneous change to any of those rides along for free. No
 * destructive-change confirmation: the expression still derives the data.
 */
const generatedRebuildStatements = (
	schema: string,
	tableName: string,
	entry: { readonly key: string; readonly next: ColumnSnapshot },
): ReadonlyArray<SqlStatement> => [
	statement(
		`alter table ${qualifyName(schema, tableName)} drop column ${quoteIdentifier(entry.key)};`,
	),
	statement(
		`alter table ${qualifyName(schema, tableName)} add column ${renderColumnDefinition(entry.next)};`,
	),
];

/** Design decision 4: generated present→absent drops the stored expression in place (PG13+ grammar) — the column keeps its physical position and its last-computed value, and simply stops recomputing from this point forward. */
const generatedDropExpressionStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop expression;`,
		),
	];
};

/** `true` when `previous` was a plain column and `next` is generated -- Postgres has no in-place alter for this transition. */
const generatedAdded = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): boolean =>
	columnGenerated(previous) === null && columnGenerated(next) !== null;

/** `true` when `previous` had no identity and `next` does -- `add generated ... as identity`. */
const identityAdded = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): boolean =>
	columnIdentity(previous) === null && columnIdentity(next) !== null;

/** `true` when `previous` had an identity and `next` doesn't -- `drop identity`. */
const identityRemoved = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): boolean =>
	columnIdentity(previous) !== null && columnIdentity(next) === null;

/** The next identity's kind when it differs from the previous one (both present), else `null`. */
const identityKindChangedTo = (
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): IdentitySnapshot["kind"] | null => {
	const previousIdentity = columnIdentity(previous);
	const nextIdentity = columnIdentity(next);
	if (
		previousIdentity === null ||
		nextIdentity === null ||
		previousIdentity.kind === nextIdentity.kind
	) {
		return null;
	}
	return nextIdentity.kind;
};

/** `alter column ... add <phrase>` -- Postgres requires the column already NOT NULL, so this must run after `set not null` (`alterColumnStatements`' own array order). */
const identityAddStatement = (
	schema: string,
	tableName: string,
	key: string,
	added: boolean,
	next: ColumnSnapshot,
): ReadonlyArray<SqlStatement> => {
	const identity = columnIdentity(next);
	if (!added || identity === null) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} add ${renderIdentityPhrase(identity)};`,
		),
	];
};

/** `alter column ... drop identity` -- Postgres rejects `drop not null` on an identity column, so this must run before `drop not null` (`alterColumnStatements`' own array order). */
const identityDropStatement = (
	schema: string,
	tableName: string,
	key: string,
	removed: boolean,
): ReadonlyArray<SqlStatement> => {
	if (!removed) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop identity;`,
		),
	];
};

/** `alter column ... set generated <keyword>` for an existing identity switching kind -- notNull is unaffected (both kinds already imply it). */
const identityKindChangeStatement = (
	schema: string,
	tableName: string,
	key: string,
	changedTo: IdentitySnapshot["kind"] | null,
): ReadonlyArray<SqlStatement> => {
	if (changedTo === null) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set generated ${IDENTITY_KIND_KEYWORD[changedTo]};`,
		),
	];
};

/**
 * `alter column ... set <token>` per identity option that gained a value
 * or changed one, in canonical order (D100/E6) — `[]` on either side
 * lacking identity (add/remove/newly-generated already cover those). An
 * option the next declaration no longer sets renders nothing (design
 * decision 3: declaration-is-truth, never a reset toward a Postgres
 * default the declaration didn't ask for).
 */
const identityOptionChangeStatements = (
	schema: string,
	tableName: string,
	key: string,
	previous: ColumnSnapshot,
	next: ColumnSnapshot,
): ReadonlyArray<SqlStatement> => {
	const previousIdentity = columnIdentity(previous);
	const nextIdentity = columnIdentity(next);
	if (previousIdentity === null || nextIdentity === null) {
		return [];
	}
	return IDENTITY_OPTION_KEYS.flatMap((optionKey) => {
		const nextValue = nextIdentity[optionKey];
		if (nextValue === undefined || nextValue === previousIdentity[optionKey]) {
			return [];
		}
		return [
			statement(
				`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set ${renderIdentityOptionToken(optionKey, nextValue)};`,
			),
		];
	});
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
	if (generatedExpressionChanged(entry.previous, entry.next)) {
		return generatedRebuildStatements(schema, tableName, entry);
	}
	if (generatedAdded(entry.previous, entry.next)) {
		return throwHejbroError(
			"unsupported-column-alter",
			`column "${entry.key}" on table "${tableName}" changed from a plain column to a generated one — Postgres has no in-place alter for this transition. Next: run generate once to drop "${entry.key}" from the declaration, then declare it generated and run generate again to re-add it.`,
		);
	}

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
	// emitAlter's `planPrimaryKeyChange` instead (see there), the same
	// rule that now also handles a PK column being added or a composite
	// PK's partial drop. All three used to be three separate special
	// cases; they're one column-set diff.

	// Absorbed from the #202 review (#24): unlike the primary key, UNIQUE
	// stays diffed and guarded per column (the approved design keeps its
	// *emission* out of scope this wave — only its name is now recorded,
	// table-kind.ts's uniqueNameField/deriveUniqueName) — but the message
	// must still carry a *why*, the same shape the other three
	// unsupported-column-alter messages in this file already do.
	if (uniqueChanged) {
		return throwHejbroError(
			"unsupported-column-alter",
			`column "${entry.key}" on table "${tableName}" changed its unique flag — a unique constraint is table-level, not expressible as a single alter column. Next: add/drop the column, or add/drop a unique constraint manually.`,
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
		// drop identity before dropping not null (Postgres rejects `drop not
		// null` on an identity column) -- see identityDropStatement's own doc.
		...identityDropStatement(
			schema,
			tableName,
			entry.key,
			identityRemoved(entry.previous, entry.next),
		),
		...notNullAlterStatements(
			schema,
			tableName,
			entry.key,
			notNullChanged,
			columnNotNull(entry.next),
		),
		// add identity after setting not null (Postgres rejects adding
		// identity to a nullable column) -- see identityAddStatement's own doc.
		...identityAddStatement(
			schema,
			tableName,
			entry.key,
			identityAdded(entry.previous, entry.next),
			entry.next,
		),
		...identityKindChangeStatement(
			schema,
			tableName,
			entry.key,
			identityKindChangedTo(entry.previous, entry.next),
		),
		...identityOptionChangeStatements(
			schema,
			tableName,
			entry.key,
			entry.previous,
			entry.next,
		),
		...defaultAlterStatements(
			schema,
			tableName,
			entry.key,
			defaultChanged,
			columnDefault(entry.next),
		),
		...generatedDropExpressionStatements(
			schema,
			tableName,
			entry.key,
			generatedRemoved(entry.previous, entry.next),
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

const emitCreateChange = (
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange>,
	nextSnapshot: Snapshot | undefined,
): ReadonlyArray<SqlStatement> =>
	emitCreate(
		asTableSnapshot(requireNext(change)),
		nextSnapshot,
		siblingChanges,
	);

const emitDropChange = (change: KindChange): ReadonlyArray<SqlStatement> =>
	emitDrop(asTableSnapshot(requirePrevious(change)));

const emitAlterChange = (
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<SqlStatement> => {
	const both = requireBoth(change);
	return emitAlter(
		asTableSnapshot(both.previous),
		asTableSnapshot(both.next),
		siblingChanges,
	);
};

/**
 * Emits SQL for a table {@link KindChange}: `create table` (+ indexes +
 * deferred FK constraints + any standing schema-wide grant re-issued for
 * this new table, #121/D78) for creates, `drop table` for drops, and
 * targeted `alter table` statements for survivors — a dropped FK goes out
 * on `predrop` (#122/A′), everything else in `main`. `siblingChanges`
 * (D74) is only used by the `alter` case's `columnDiff.added` rendering,
 * to inline a serial-family added column's sequence-backed default (#23)
 * — see `sequenceForAddedColumn`'s doc comment. `nextSnapshot` (D78) is
 * only used by the `create` case — see `standingGrantStatements`'s doc
 * comment. `dispatchEmit`'s handler map is 2-parameter
 * (`EmitOperationHandlers`, shared by 3 other kinds); `create`'s own
 * 3-parameter `emitCreateChange` is closed over `nextSnapshot` here
 * rather than widening that shared type for one kind's one case.
 */
export const emitTableSql = (
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange> = [],
	nextSnapshot?: Snapshot,
): ReadonlyArray<SqlStatement> =>
	dispatchEmit(
		{
			create: (createChange, createSiblingChanges) =>
				emitCreateChange(createChange, createSiblingChanges, nextSnapshot),
			alter: emitAlterChange,
			drop: emitDropChange,
		},
		change,
		siblingChanges,
	);
