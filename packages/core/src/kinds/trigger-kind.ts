import type { TriggerDeclaration } from "../dsl/define-trigger";
import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type {
	TriggerEventShape,
	TriggerSnapshotShape,
} from "../plpgsql/render-body";
import { renderTriggerSql } from "../plpgsql/render-body";
import type { JsonValue } from "../snapshot/stable-json";
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
 * The built-in object kind for Postgres triggers. Identity is
 * `"<schema>.<table>.<name>"`. Postgres has no `alter trigger` for
 * event/timing/function changes, so `diff` treats any field difference as
 * a single `alter` change (**not** a separate drop + create pair — the
 * diff engine's global create/alter-before-drop ordering would otherwise
 * hoist a same-identity create ahead of its own drop, dropping the trigger
 * it just created; see #55) whose `emit` returns the `drop trigger if
 * exists` and `create trigger` statements in that order (idempotent
 * recreate, spec §6.5) — including on a true first-time create. The drop
 * half (recreate, and a true drop) goes out on the `predrop` stage — a
 * trigger's `update of <column>` event list can name a column that a
 * `main`-stage alter on that same table is about to drop (#122), so the
 * trigger must be gone before that alter runs — a true first-time create's
 * `drop trigger if exists` is just idempotent guard text (nothing can
 * depend on a trigger that doesn't exist yet), so it stays in `main`
 * alongside its own `create trigger`.
 */
export const triggerKind: ObjectKind<TriggerDeclaration> = {
	kind: "trigger",
	dependsOn: ["function", "table"],
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
		if (previous === null && next !== null) {
			return [
				{
					kind: "trigger",
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
					kind: "trigger",
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
		if (sameJson(previous, next)) {
			return [];
		}
		return [
			{
				kind: "trigger",
				operation: "alter",
				identity,
				previous,
				next,
				notes: [TRIGGER_CHANGED_NOTE],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"trigger create change is missing its next snapshot.",
					);
				}
				// A first-time create's `drop trigger if exists` is idempotent
				// guard text, not a real drop — nothing can already depend on a
				// trigger that doesn't exist yet, so it stays in `main` right
				// next to its own `create trigger` (#122/A′; only `alter`'s and
				// `drop`'s drop halves need `predrop`).
				const [dropSql, createSql] = renderTriggerSql(
					asTriggerSnapshot(change.next),
				);
				return [statement(dropSql), statement(createSql)];
			}
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"trigger alter change is missing its next snapshot.",
					);
				}
				const [dropSql, createSql] = renderTriggerSql(
					asTriggerSnapshot(change.next),
				);
				return [predropStatement(dropSql), statement(createSql)];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"trigger drop change is missing its previous snapshot.",
					);
				}
				const [dropSql] = renderTriggerSql(asTriggerSnapshot(change.previous));
				return [predropStatement(dropSql)];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
