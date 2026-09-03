import { throwHejbroError } from "../error";
import type { JsonValue } from "../snapshot/stable-json";
import type { SqlStatement } from "../sql/statement";
import type { ChangeOperation, KindChange } from "./object-kind";

/**
 * One handler per {@link ChangeOperation} — a mapped type over the full
 * `"create" | "alter" | "drop"` union, not a hand-written list, so a
 * missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(change.operation)` would have been (same
 * technique as #154 PR2's `TypeNode`/`ExprNode` walkers). Unlike those,
 * `KindChange` itself doesn't narrow `previous`/`next` per operation —
 * every built-in kind's own handler still opens with a null check on
 * whichever of `previous`/`next` that operation needs, now delegated to
 * {@link requireNext}/{@link requirePrevious}/{@link requireBoth} below
 * rather than repeating the check inline (#472).
 */
export type EmitOperationHandlers = {
	readonly [K in ChangeOperation]: (
		change: KindChange,
		siblingChanges: ReadonlyArray<KindChange>,
	) => ReadonlyArray<SqlStatement>;
};

/**
 * Dispatches `change` to the one handler in `handlers` matching its own
 * `operation` — the shared replacement for the `switch (change.operation)
 * { … default: assertNever(change.operation) }` four built-in kinds
 * (`view-kind.ts`, `function-kind.ts`, `enum-kind.ts`,
 * `table-kind-emit.ts`) opened their own `emit` with (#154 PR2, CRAP
 * refactor). Each case's own body stays in that kind's own file as its
 * own named handler; only the dispatch itself is shared. Its "missing
 * next/previous snapshot" error text no longer differs per kind by
 * design (#472 measured all 31 sites as one template restating
 * `change.kind`/`change.operation`, not kind-specific content) — see
 * {@link requireNext}/{@link requirePrevious}/{@link requireBoth}.
 */
export const dispatchEmit = (
	handlers: EmitOperationHandlers,
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange> = [],
): ReadonlyArray<SqlStatement> =>
	handlers[change.operation](change, siblingChanges);

/**
 * Narrows `change.next` to non-null, or throws `invalid-kind-change` with
 * the shared wording every built-in kind's own `create`/`alter` handler
 * open with (#472: 11 of the 31 sites, byte-identical apart from `kind`/
 * `operation`).
 */
export const requireNext = (change: KindChange): JsonValue => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			`${change.kind} ${change.operation} change is missing its next snapshot.`,
		);
	}
	return change.next;
};

/**
 * Narrows `change.previous` to non-null, or throws `invalid-kind-change`
 * with the shared wording every built-in kind's own `drop`/`alter` handler
 * opens with (#472: 18 of the 31 sites).
 */
export const requirePrevious = (change: KindChange): JsonValue => {
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			`${change.kind} ${change.operation} change is missing its previous snapshot.`,
		);
	}
	return change.previous;
};

/**
 * Narrows both `change.previous` and `change.next` to non-null in one
 * guard, or throws `invalid-kind-change` with the combined wording — the
 * 2 remaining sites (`enum-kind.ts`, `table-kind-emit.ts`) whose `alter`
 * handler needs both snapshots at once and reports one message for either
 * being missing, not two (#472).
 */
export const requireBoth = (
	change: KindChange,
): { readonly previous: JsonValue; readonly next: JsonValue } => {
	if (change.previous === null || change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			`${change.kind} ${change.operation} change is missing its previous or next snapshot.`,
		);
	}
	return { previous: change.previous, next: change.next };
};
