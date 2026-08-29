import type { SelectNode, SetOpNode } from "../expr/ast";
import type { CteEntryOptions } from "./with";

/**
 * A recursive entry's own hints (add-ctes, task 6.1) — `materialized`
 * (tri-state, same as {@link CteEntryOptions}) plus `all`, the recursive
 * branch's only combinator choice (task 6.3): `true` renders `union all`
 * (no duplicate check between iterations, the form every measured fixture
 * in `design.md` uses and the common idiom for a terminating recursion),
 * `false` renders plain `union` (Postgres accepts both, measured — task
 * 6.5). Defaults to `true` when omitted.
 *
 * Surface: `w.as`'s own `CteEntryOptions` has no combinator field —
 * exposing `all` there would offer a meaningless choice on a plain entry,
 * which has no anchor/recursive-term pair to combine. `<Verb>Options`
 * keeps the same suffix `CteEntryOptions` already uses for this exact
 * role, one level down.
 */
export type RecursiveCteEntryOptions = CteEntryOptions & {
	readonly all?: boolean;
};

/**
 * Combines an anchor and a recursive term into the one `SetOpNode` shape
 * `WITH RECURSIVE` accepts (add-ctes, task 6.3) — built directly, never
 * through `SetOpStage`'s own chainable combinators, which is what makes
 * the four measured server rejections (`design.md`'s refuse table)
 * unrepresentable rather than merely unguarded: `operator` is hardcoded to
 * `"union"` (`intersect`/`except` are never spelled, closing `42P19`
 * `recursive query "r" does not have the form non-recursive-term UNION
 * [ALL] recursive-term`), and `orderBy`/`limit`/`offset` are hardcoded
 * empty/`null` (closing the three `0A000 ... in a recursive query is not
 * implemented` cases — none of them has a chain method here that could
 * populate one). Lead-approved direction, 2026-08-29: maximise
 * unrepresentability over a build-time check for a shape this builder can
 * simply never construct.
 */
export const buildRecursiveEntryQuery = (
	anchor: SelectNode | SetOpNode,
	recursiveTerm: SelectNode | SetOpNode,
	all: boolean,
): SetOpNode => ({
	queryKind: "setOp",
	operator: "union",
	all,
	left: anchor,
	right: recursiveTerm,
	orderBy: [],
	limit: null,
	offset: null,
});
