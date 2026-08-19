import type { TriggerDeclaration } from "../dsl/define-trigger";
import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import { renderTriggerSql } from "../plpgsql/render-body";
import type { JsonValue } from "../snapshot/stable-json";
import { statement } from "../sql/statement";

/** One event entry in a {@link TriggerSnapshot} — mirrors `TriggerDeclaration["events"][number]`. */
export type TriggerEventSnapshot =
	| { readonly event: "insert" }
	| { readonly event: "delete" }
	| {
			readonly event: "update";
			readonly columns: ReadonlyArray<string> | null;
	  };

/** A trigger's serialized snapshot node. */
export type TriggerSnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly timing: "before" | "after";
	readonly events: ReadonlyArray<TriggerEventSnapshot>;
	readonly forEach: "row" | "statement";
	readonly functionName: string;
};

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
 * a drop+create pair; `emit` on create always returns both the
 * `drop trigger if exists` and `create trigger` statements (idempotent
 * recreate, spec §6.5) — including on a true first-time create.
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
			functionName: declaration.functionName,
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
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [TRIGGER_CHANGED_NOTE],
			},
			{
				kind: "trigger",
				operation: "create",
				identity,
				previous: null,
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
				const [dropSql, createSql] = renderTriggerSql(
					asTriggerSnapshot(change.next),
				);
				return [statement(dropSql), statement(createSql)];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"trigger drop change is missing its previous snapshot.",
					);
				}
				const [dropSql] = renderTriggerSql(asTriggerSnapshot(change.previous));
				return [statement(dropSql)];
			}
			case "alter":
				return throwHejbroError(
					"invalid-kind-change",
					"trigger kind never produces an alter change — this indicates an internal hejbro bug.",
				);
			default:
				return assertNever(change.operation);
		}
	},
};
