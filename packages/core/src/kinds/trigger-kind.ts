import type { TriggerDeclaration } from "../dsl/define-trigger";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import { requireNext, requirePrevious } from "../kind/emit-helpers";
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
import { compareKeys } from "../sort";
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
	const [dropSql, createSql] = renderTriggerSql(
		asTriggerSnapshot(requireNext(change)),
	);
	return [statement(dropSql), statement(createSql)];
};

/** {@link triggerKind}'s `emit`, `"alter"` case: drop (predrop stage, #122) then recreate. */
const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
	const nextSnapshot = asTriggerSnapshot(requireNext(change));
	const dropSql = renderTriggerDropSql(nextSnapshot, false);
	const createSql = renderTriggerCreateSql(nextSnapshot);
	return [predropStatement(dropSql), statement(createSql)];
};

/** {@link triggerKind}'s `emit`, `"drop"` case: a bare `drop trigger` (D75, predrop stage). */
const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => {
	const dropSql = renderTriggerDropSql(
		asTriggerSnapshot(requirePrevious(change)),
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

/** `events`' fixed rank (#701, D3) — insert, update, delete, an order the database never reads (Postgres accepts any `or`-joined order in `create trigger`), so two declarations listing the same events in a different order serialize to byte-identical nodes. */
const EVENT_RANK: Readonly<Record<TriggerEventShape["event"], number>> = {
	insert: 0,
	update: 1,
	delete: 2,
};

/** Sorts an `update` event's own `columns` by name (#701, D3) — `null` (no column list, a bare `update`) passes through unchanged; every other event carries no array of its own to sort. */
const canonicalizeEvent = (event: TriggerEventShape): TriggerEventShape => {
	if (event.event !== "update" || event.columns === null) {
		return event;
	}
	return { ...event, columns: [...event.columns].sort(compareKeys) };
};

/**
 * Orders `events` by {@link EVENT_RANK} and sorts an `update` event's own
 * column list (#701, D3) — `renderTriggerCreateSql`'s own `eventsSql`
 * joins straight from this array, so a `create trigger … after …` clause
 * also follows this order for any trigger created or recreated from now
 * on.
 */
const canonicalizeTrigger = (node: JsonValue): JsonValue => {
	const snapshot = asTriggerSnapshot(node);
	return {
		...snapshot,
		events: [...snapshot.events]
			.map(canonicalizeEvent)
			.sort((a, b) => EVENT_RANK[a.event] - EVENT_RANK[b.event]),
	};
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
	canonicalize: canonicalizeTrigger,
};
