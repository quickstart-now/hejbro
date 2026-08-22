import type { SqlStatement } from "../sql/statement";
import type { ChangeOperation, KindChange } from "./object-kind";

/**
 * One handler per {@link ChangeOperation} — a mapped type over the full
 * `"create" | "alter" | "drop"` union, not a hand-written list, so a
 * missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(change.operation)` would have been (same
 * technique as #154 PR2's `TypeNode`/`ExprNode` walkers). Unlike those,
 * `KindChange` itself doesn't narrow `previous`/`next` per operation —
 * every built-in kind's own three handlers still open with their own
 * null check on whichever of `previous`/`next` that operation needs, the
 * same as the `switch` bodies did before this extraction.
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
 * refactor). Each case's own body — including its own "missing next/
 * previous snapshot" error text, which differs per kind — stays in that
 * kind's own file as its own named handler; only the dispatch itself is
 * shared.
 */
export const dispatchEmit = (
	handlers: EmitOperationHandlers,
	change: KindChange,
	siblingChanges: ReadonlyArray<KindChange> = [],
): ReadonlyArray<SqlStatement> =>
	handlers[change.operation](change, siblingChanges);
