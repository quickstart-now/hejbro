import { throwHejbroError } from "../error";
import type { SelectNode, SetOpNode } from "../expr/ast";
import { leftBranchOutputColumns } from "../expr/render-sql";

/** The first position at which two key lists disagree (either a different key, or one list running out), or `undefined` if they agree at every position they both have — {@link assertSameSetOpKeyOrder}'s own scan. `Math.max` covers a length mismatch too, though `SameKeys` (`query/select.ts`) already guarantees equal length in the typed builder call path — a hand-assembled node (e.g. `with-recursive.ts`'s anchor/recursive-term pair, or a decoded snapshot) carries no such guarantee, so this stays defensive rather than assuming it. */
type KeyOrderMismatch = {
	readonly position: number;
	readonly leftKey: string | undefined;
	readonly rightKey: string | undefined;
};
const findKeyOrderMismatch = (
	left: ReadonlyArray<string>,
	right: ReadonlyArray<string>,
): KeyOrderMismatch | undefined =>
	Array.from(
		{ length: Math.max(left.length, right.length) },
		(_, position) => ({
			position,
			leftKey: left[position],
			rightKey: right[position],
		}),
	).find((entry) => entry.leftKey !== entry.rightKey);

/**
 * Rejects two set-op branches whose OUTPUT columns list the same names in
 * a different ORDER (#487, second half — harden-query-surface group 8).
 * `SameKeys`/`SetOpResult` (`query/select.ts`) check the key SET, which
 * `keyof` can see; `keyof` has no order, so a same-set-different-order
 * pair still type-checks there. Postgres itself matches set-operation
 * branches by POSITION, not by name, so that pair still compiles today
 * and produces silent data corruption at the server, not an error —
 * measured on postgres:17, unioning `{email, city}` against `{city,
 * email}`: the `email` output column comes back holding a city value and
 * vice versa. A genuine type divergence between branches is already
 * caught by the server itself (`UNION types uuid and text cannot be
 * matched`, measured) — this guard covers exactly the half the server
 * cannot see, where the types match and only the declared order differs.
 * It cannot be a type-level check (no key order in `keyof`), so it is a
 * runtime guard — still pure, no I/O — over each branch's own rendered
 * OUTPUT column order ({@link leftBranchOutputColumns}, reused here for
 * either side: a branch's own output order is its own leftmost select's,
 * recursively, the same "left branch's keys win" rule `SetOpResult`
 * already states), taking `SelectNode | SetOpNode` — the query nodes
 * every construction site (`query/select.ts`'s `combineSetOp`,
 * `@hejbro/query`'s chain `combine`, and `with-recursive.ts`'s
 * `buildRecursiveEntryQuery`) already builds its branches into, rather
 * than the original `SelectProjection` object, so one implementation
 * serves every site without any of them reconstructing another's runtime
 * shape.
 *
 * Lives in its own module, not `query/select.ts`, so `with-recursive.ts`
 * can import it without a cycle: `with.ts` already imports
 * `with-recursive.ts` (value) and `select.ts` (types only, erased), and
 * `select.ts` imports `with.ts` (value) — closing a fourth edge here
 * (`with-recursive.ts` importing a VALUE from `select.ts`) would complete
 * a runtime import cycle across three files. This module depends on
 * nothing from `query/`, so none of the three needs to import another.
 */
export const assertSameSetOpKeyOrder = (
	left: SelectNode | SetOpNode,
	right: SelectNode | SetOpNode,
): void => {
	const leftOrder = leftBranchOutputColumns(left);
	const rightOrder = leftBranchOutputColumns(right);
	const mismatch = findKeyOrderMismatch(leftOrder, rightOrder);
	if (mismatch === undefined) {
		return;
	}
	throwHejbroError(
		"set-op-key-order-mismatch",
		`a set operation's branches list the same keys in a different order — left: (${leftOrder.join(", ")}), right: (${rightOrder.join(", ")}), disagreeing at position ${mismatch.position + 1} ("${mismatch.leftKey ?? "(none)"}" vs "${mismatch.rightKey ?? "(none)"}"). Postgres matches set-operation branches by position, not by name, so this compiles and silently mismatches every row's columns from that position on. Next: reorder one branch's projection so both list the same keys in the same order.`,
	);
};
