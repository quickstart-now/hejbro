import { throwHejbroError } from "../error";
import type { SelectNode, SetOpNode } from "../expr/ast";
import { leftBranchOutputColumns } from "../expr/render-sql";

/**
 * Which keys are only on one side, or `undefined` when both sides carry
 * exactly the same SET of keys (order not considered — that is
 * {@link findKeyOrderMismatch}'s question, asked only once this one comes
 * back `undefined`, group 8.4). A positional scan alone (the pre-8.4
 * shape) cannot tell "same keys, different order" apart from "different
 * keys entirely" or "a key is missing" — it reports "different order"
 * for all three, and "reorder one branch's projection" is not a remedy
 * for the second or third. This runs FIRST and is load-bearing for that
 * reason: a pair that is both set- and order-mismatched
 * (`{id,email}` vs `{town,id}`) must land here, on the code whose remedy
 * ("project the same keys") is actually true, not on the order code.
 */
type KeySetMismatch = {
	readonly onlyInLeft: ReadonlyArray<string>;
	readonly onlyInRight: ReadonlyArray<string>;
};
const findKeySetMismatch = (
	left: ReadonlyArray<string>,
	right: ReadonlyArray<string>,
): KeySetMismatch | undefined => {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	const onlyInLeft = left.filter((key) => !rightSet.has(key));
	const onlyInRight = right.filter((key) => !leftSet.has(key));
	if (onlyInLeft.length === 0 && onlyInRight.length === 0) {
		return undefined;
	}
	return { onlyInLeft, onlyInRight };
};

/** `(none)` for an empty list, else its keys quoted and comma-joined — {@link throwKeySetMismatch}'s own field. */
const describeKeys = (keys: ReadonlyArray<string>): string => {
	if (keys.length === 0) {
		return "(none)";
	}
	return keys.map((key) => `"${key}"`).join(", ");
};

/** Rejects two set-op branches whose OUTPUT columns are not the same SET (group 8.4) — a genuinely different key list, or one side missing a key the other has. Distinct from {@link findKeyOrderMismatch}'s code: "project the same keys" is the remedy for this one; "reorder" is not, because there is nothing correctly-keyed to reorder. */
const throwKeySetMismatch = (
	leftOrder: ReadonlyArray<string>,
	rightOrder: ReadonlyArray<string>,
	mismatch: KeySetMismatch,
): never =>
	throwHejbroError(
		"set-op-key-set-mismatch",
		`a set operation's branches project different keys — left: (${leftOrder.join(", ")}), right: (${rightOrder.join(", ")}); only in left: ${describeKeys(mismatch.onlyInLeft)}, only in right: ${describeKeys(mismatch.onlyInRight)}. Postgres matches set-operation branches by position, so both branches must project exactly the same keys. Next: make both branches' projections list the same keys, then align their order if needed.`,
	);

/** The first position at which two SAME-SET key lists disagree, or `undefined` if they agree at every position — {@link assertSameSetOpKeyOrder}'s second check, run only once {@link findKeySetMismatch} has already returned `undefined` (group 8.4: a set mismatch is diagnosed there, never here). `Math.max` is defensive leftover from when this ran alone against possibly-unequal-length inputs; with the set check gating it, both lists are always the same length by the time this runs. */
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
 * Rejects two set-op branches whose OUTPUT columns are not the same SET,
 * in the same ORDER (#487, second half — harden-query-surface group 8).
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
 * Two codes, checked in this order (group 8.4 — found in review: a pure
 * positional scan cannot distinguish "same keys, different order" from
 * "different keys" or "a key is missing", and reported all three as
 * "different order" with a "reorder" remedy that only the first one can
 * actually follow). `set-op-key-set-mismatch` runs FIRST and covers a
 * genuinely different key set — one remedy either way ("project the
 * same keys"), so one code, not one per way the set can differ.
 * `set-op-key-order-mismatch` runs only once the sets already match, so
 * "reorder" is always a real, followable instruction by the time it is
 * given.
 *
 * Lives in its own module, not `query/select.ts`, so `with-recursive.ts`
 * can import it without a cycle: `with.ts` already imports
 * `with-recursive.ts` (value) and `select.ts` (types only, erased), and
 * `select.ts` imports `with.ts` (value) — closing a fourth edge here
 * (`with-recursive.ts` importing a VALUE from `select.ts`) would complete
 * a runtime import cycle across three files. This module depends on
 * nothing from `query/`, so none of the three needs to import another.
 *
 * A fourth mangled-diagnosis case was considered and ruled out (review):
 * `leftBranchOutputColumns` returns `[]` for a `constantOne` projection
 * (`select 1`, always empty output columns), which would compare as a
 * key-SET mismatch against any non-empty branch. Not reachable through
 * the public builder: `select()` only ever produces `allColumns`/
 * `columns` projections (`query/select.ts`); `constantOne` is built
 * exclusively by `exists()`/`notExists()` (`buildExists`), which return
 * `Expr<"boolean">`, never a chainable `SelectLimited`/`SetOpStage` a
 * combinator could take as `other`. Only a hand-assembled `SelectNode`
 * could carry `constantOne` into this guard — the same input class
 * (decoded snapshot, hand-built IR) this guard is already documented as
 * defensive against, not a fifth one.
 */
export const assertSameSetOpKeyOrder = (
	left: SelectNode | SetOpNode,
	right: SelectNode | SetOpNode,
): void => {
	const leftOrder = leftBranchOutputColumns(left);
	const rightOrder = leftBranchOutputColumns(right);
	const setMismatch = findKeySetMismatch(leftOrder, rightOrder);
	if (setMismatch !== undefined) {
		throwKeySetMismatch(leftOrder, rightOrder, setMismatch);
	}
	const orderMismatch = findKeyOrderMismatch(leftOrder, rightOrder);
	if (orderMismatch === undefined) {
		return;
	}
	throwHejbroError(
		"set-op-key-order-mismatch",
		`a set operation's branches list the same keys in a different order — left: (${leftOrder.join(", ")}), right: (${rightOrder.join(", ")}), disagreeing at position ${orderMismatch.position + 1} ("${orderMismatch.leftKey ?? "(none)"}" vs "${orderMismatch.rightKey ?? "(none)"}"). Postgres matches set-operation branches by position, not by name, so this compiles and silently mismatches every row's columns from that position on. Next: reorder one branch's projection so both list the same keys in the same order.`,
	);
};
