import type { TriggerDeclaration } from "../dsl/define-trigger";
import { throwHejbroError } from "../error";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import type {
	ChangeOperation,
	KindChange,
	ObjectKind,
} from "../kind/object-kind";
import type {
	TriggerEventShape,
	TriggerSnapshotShape,
} from "../plpgsql/render-body";
import {
	renderTriggerCreateSql,
	renderTriggerDropSql,
	renderTriggerSql,
} from "../plpgsql/render-body";
import type { JsonValue } from "../snapshot/stable-json";
import type { SqlStatement } from "../sql/statement";
import { predropStatement, statement } from "../sql/statement";

/**
 * One event entry in a {@link TriggerSnapshot} — an alias of
 * {@link TriggerEventShape} (render-body.ts owns the one canonical shape;
 * this re-export keeps the kind-facing name).
 */
export type TriggerEventSnapshot = TriggerEventShape;

/**
 * A trigger's serialized snapshot node — an alias of
 * {@link TriggerSnapshotShape} (render-body.ts owns the one canonical
 * shape; this re-export keeps the kind-facing name). `render-body.ts` stays
 * kind-agnostic: it depends on the shape, never the other way around.
 */
export type TriggerSnapshot = TriggerSnapshotShape;

// Internal invariant: this shape is exactly what triggerKind.serialize below produces.
const asTriggerSnapshot = (snapshot: JsonValue): TriggerSnapshot =>
	snapshot as TriggerSnapshot;

const triggerIdentity = (schema: string, table: string, name: string): string =>
	`${schema}.${table}.${name}`;

const TRIGGER_CHANGED_NOTE = "trigger changed; recreating";

/**
 * {@link triggerKind}'s `emit`, `"create"` case: a first-time create's
 * `drop trigger if exists` is idempotent guard text, not a real drop —
 * nothing can already depend on a trigger that doesn't exist yet, so it
 * stays in `main` right next to its own `create trigger` (#122/A′; only
 * `alter`'s and `drop`'s drop halves need `predrop`).
 */
const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"trigger create change is missing its next snapshot.",
		);
	}
	const [dropSql, createSql] = renderTriggerSql(asTriggerSnapshot(change.next));
	return [statement(dropSql), statement(createSql)];
};

/** {@link triggerKind}'s `emit`, `"alter"` case: drop (predrop stage, #122) then recreate. */
const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"trigger alter change is missing its next snapshot.",
		);
	}
	const nextSnapshot = asTriggerSnapshot(change.next);
	const dropSql = renderTriggerDropSql(nextSnapshot, false);
	const createSql = renderTriggerCreateSql(nextSnapshot);
	return [predropStatement(dropSql), statement(createSql)];
};

/** {@link triggerKind}'s `emit`, `"drop"` case: a bare `drop trigger` (D75, predrop stage). */
const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"trigger drop change is missing its previous snapshot.",
		);
	}
	const dropSql = renderTriggerDropSql(
		asTriggerSnapshot(change.previous),
		false,
	);
	return [predropStatement(dropSql)];
};

/**
 * One handler per {@link ChangeOperation}, same technique used across this
 * phase's other `emit` splits (#154 ratchet-5).
 */
type EmitHandlers = {
	readonly [K in ChangeOperation]: (
		change: KindChange,
	) => ReadonlyArray<SqlStatement>;
};

const emitHandlers: EmitHandlers = {
	create: emitCreate,
	alter: emitAlter,
	drop: emitDrop,
};

/**
 * The built-in object kind for Postgres triggers. Identity is
 * `"<schema>.<table>.<name>"`. Postgres has no `alter trigger` for
 * event/timing/function changes, so `diff` treats any field difference as
 * a single `alter` change (**not** a separate drop + create pair — the
 * diff engine's global create/alter-before-drop ordering would otherwise
 * hoist a same-identity create ahead of its own drop, dropping the trigger
 * it just created; see #55) whose `emit` returns a drop and a `create
 * trigger` statement in that order (idempotent recreate on create only,
 * spec §6.5). Only a true first-time create's drop half uses `if exists`
 * (idempotent guard text — nothing can already depend on a trigger that
 * doesn't exist yet, so it stays in `main` alongside its own `create
 * trigger`); `alter`/`drop` emit a bare `drop trigger` (D75) so an
 * out-of-band removal of a trigger hejbro still declares fails loudly at
 * the next change instead of `if exists` silently re-creating it. The
 * drop half (recreate, and a true drop) goes out on the `predrop` stage —
 * a trigger's `update of <column>` event list can name a column that a
 * `main`-stage alter on that same table is about to drop (#122), so the
 * trigger must be gone before that alter runs.
 */
export const triggerKind: ObjectKind<TriggerDeclaration> = {
	kind: "trigger",
	dependsOn: ["function", "table"],
	requiredKeys: [
		"schema",
		"table",
		"name",
		"timing",
		"events",
		"forEach",
		"function",
	],
	owns: (declaration): declaration is TriggerDeclaration =>
		declaration.declarationKind === "trigger",
	serialize: (declaration) => {
		const snapshot: TriggerSnapshot = {
			schema: declaration.schemaName,
			table: declaration.tableName,
			name: declaration.triggerName,
			timing: declaration.timing,
			events: declaration.events,
			forEach: declaration.forEach,
			function: declaration.functionName,
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const triggerSnapshot = asTriggerSnapshot(snapshot);
		return triggerIdentity(
			triggerSnapshot.schema,
			triggerSnapshot.table,
			triggerSnapshot.name,
		);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("trigger", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}
		if (sameJson(guard.previous, guard.next)) {
			return [];
		}
		return [
			{
				kind: "trigger",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [TRIGGER_CHANGED_NOTE],
			},
		];
	},
	emit: (change) => emitHandlers[change.operation](change),
};
