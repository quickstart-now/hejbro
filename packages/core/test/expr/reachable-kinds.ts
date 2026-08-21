import type { ExprNode, ProjectionNode } from "../../src/expr/ast";
import {
	NODE_KIND_TO_SNAPSHOT,
	PROJECTION_KIND_TO_SNAPSHOT,
} from "../../src/expr/codec";

/**
 * Single source of truth for which `ExprNode`/`ProjectionNode` kinds are
 * reachable through this PR's four target fields (column default, CHECK,
 * partial-index `where`, policy `using`/`withCheck`), and why the rest
 * aren't (#110 reviewer round 3, item 72).
 *
 * Before this module existed, the reference-identity loop test
 * (`retarget.test.ts`) and the D70 map-completeness test
 * (`naming-conventions.test.ts`) each maintained their own separate list
 * of node kinds — exactly the kind of duplication that let a real defect
 * (`retargetTableRef`'s identity bug) survive one earlier "add a case,
 * write a test for that one case" cycle already, because the test that
 * would have caught the sibling gap was scoped too narrowly to see it.
 * Deriving both from this one array means a kind added to one without
 * the other can't happen silently.
 *
 * `REACHABLE_NODE_KINDS`/`REACHABLE_PROJECTION_KINDS` are computed from
 * `NODE_KIND_TO_SNAPSHOT`/`PROJECTION_KIND_TO_SNAPSHOT` — already
 * exhaustive over the `ExprNode`/`ProjectionNode` unions by their own
 * `Record<..., string>` type annotations, so a brand-new union member
 * without a map entry is a compile error before this file is ever
 * reached — minus the categorized unreachable sets below. A brand-new
 * node/projection kind therefore lands in `REACHABLE_*` automatically
 * unless someone deliberately excludes it here, with a reason.
 *
 * Two categories of "unreachable", backed differently on purpose:
 *  - `"constructional"`: the DSL has no code path that can ever build
 *    this shape at all — a structural fact, true regardless of any other
 *    function's current implementation. Prose is enough.
 *  - `"current-code-dependent"`: the shape COULD be built, but is
 *    unreachable only because some *other* function currently
 *    discards/overrides it. That fact can silently stop being true the
 *    next time that function is edited — unlike the constructional case,
 *    prose alone would go stale without anyone noticing. Every such
 *    entry must be backed by an actual pinning test (named in the
 *    `reason`), not just a comment, so that changing the other
 *    function's behavior turns the pinning test red first and forces
 *    whoever changes it to revisit this list too (the pinning test lives
 *    in `naming-conventions.test.ts`, next to the fixture it backs).
 */
export type UnreachableEntry<TKind extends string> = {
	readonly kind: TKind;
	readonly category: "constructional" | "current-code-dependent";
	readonly reason: string;
};

export const UNREACHABLE_NODE_KINDS: ReadonlyArray<
	UnreachableEntry<ExprNode["nodeKind"]>
> = [
	{
		kind: "plpgsqlRef",
		category: "constructional",
		reason:
			"the DSL has no way to construct a plpgsqlRef outside a plpgsql function body (defineTrigger/defineFunction's ctx.* helpers), and none of the four fields expression nodes are stored in today (column default, CHECK, partial-index where, policy using/withCheck) are plpgsql body statements",
	},
];

export const UNREACHABLE_PROJECTION_KINDS: ReadonlyArray<
	UnreachableEntry<ProjectionNode["projectionKind"]>
> = [
	{
		kind: "allColumns",
		category: "current-code-dependent",
		reason:
			"select(table) resolves to an allColumns projection, but exists()/notExists() (query/select.ts's buildExists) unconditionally overwrites the subquery's projection with constantOne regardless of what was selected -- pinned by \"exists()/notExists() always normalize their subquery's projection to constantOne\" in naming-conventions.test.ts",
	},
	{
		kind: "columns",
		category: "current-code-dependent",
		reason:
			"select({ ... }, table) resolves to a columns projection, but buildExists overwrites it the exact same way as allColumns -- pinned by the same test",
	},
];

const isUnreachableNodeKind = (kind: ExprNode["nodeKind"]): boolean =>
	UNREACHABLE_NODE_KINDS.some((entry) => entry.kind === kind);

const isUnreachableProjectionKind = (
	kind: ProjectionNode["projectionKind"],
): boolean => UNREACHABLE_PROJECTION_KINDS.some((entry) => entry.kind === kind);

export const REACHABLE_NODE_KINDS: ReadonlyArray<ExprNode["nodeKind"]> = (
	Object.keys(NODE_KIND_TO_SNAPSHOT) as ReadonlyArray<ExprNode["nodeKind"]>
).filter((kind) => !isUnreachableNodeKind(kind));

export const REACHABLE_PROJECTION_KINDS: ReadonlyArray<
	ProjectionNode["projectionKind"]
> = (
	Object.keys(PROJECTION_KIND_TO_SNAPSHOT) as ReadonlyArray<
		ProjectionNode["projectionKind"]
	>
).filter((kind) => !isUnreachableProjectionKind(kind));
