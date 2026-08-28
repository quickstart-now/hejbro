import { assertNever } from "../../src/error";
import type { ExprNode, ProjectionNode } from "../../src/expr/ast";
import {
	NODE_KIND_TO_SNAPSHOT,
	PROJECTION_KIND_TO_SNAPSHOT,
} from "../../src/expr/codec";

/**
 * Single source of truth for which `ExprNode`/`ProjectionNode` kinds are
 * reachable through the five fields the expression codec serializes today
 * (column default, CHECK, partial-index `where`, policy `using`/
 * `withCheck` — #110/D67/D70 — and, since #157/D72, a view's own `query`),
 * and why the rest aren't.
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
 *
 * `allColumns`/`columns` (projection kinds) moved OUT of the unreachable
 * set in #157: they were unreachable only through `exists()`, which
 * always normalizes to `constantOne` (`buildExists`, still pinned below)
 * — but a view's own top-level query is never routed through
 * `buildExists`, and `defineView` accepts either `select(table)`
 * (`allColumns`) or `select({...}, table)` (`columns`), so both are
 * genuinely reachable via a real declaration now. This is the exact
 * opposite of `exists()`'s own reachable set (`constantOne` only) —
 * proof that "unreachable" was always a property of a specific field's
 * producer, not of the codec itself, which is why this list is a single
 * shared source rather than one the D70 fixture and this file can drift
 * on their own.
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
			"the DSL has no way to construct a plpgsqlRef outside a plpgsql function body (defineTrigger/defineFunction's ctx.* helpers), and none of the five fields expression nodes are stored in today (column default, CHECK, partial-index where, policy using/withCheck, view query) are plpgsql body statements",
	},
];

export const UNREACHABLE_PROJECTION_KINDS: ReadonlyArray<
	UnreachableEntry<ProjectionNode["projectionKind"]>
> = [];

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

// --- shared no-op-rename case builder ------------------------------------

/** A `columnRef` on `app.posts.subtitle` — used as the "unrelated leaf" every composite case below wraps, so a `columnRenameTarget` for `app.posts.title` never matches it. */
export const unrelatedColumnRef: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "posts",
	columnName: "subtitle",
};

/** A bare number literal — references nothing, so it's unaffected by any rename target. */
export const unrelatedLiteral: ExprNode = {
	nodeKind: "literal",
	literal: { literalKind: "number", value: 1 },
};

/**
 * Builds a minimal, valid `ExprNode` of `kind` that does NOT reference
 * `columnRenameTarget`'s column (`retarget.test.ts`'s fixture) anywhere in
 * its subtree — used by every reference-identity loop test that needs one
 * case per reachable node kind (#110 item 72, #157 item 96). An exhaustive
 * switch (compiler-enforced via `assertNever`), so a new `ExprNode` member
 * fails to compile here until given a case. `exists` alone covers BOTH
 * `retargetTableRef` call sites at once (`query.from` and `join.table`),
 * matching the same table on both, since that's precisely the shape
 * #110's reviewer round 2/3 found broken.
 */
export const buildUnrelatedCase = (kind: ExprNode["nodeKind"]): ExprNode => {
	switch (kind) {
		case "literal":
			return unrelatedLiteral;
		case "columnRef":
			return unrelatedColumnRef;
		case "plpgsqlRef":
			return { nodeKind: "plpgsqlRef", path: ["new", "x"] };
		case "comparison":
			return {
				nodeKind: "comparison",
				operator: "=",
				left: unrelatedColumnRef,
				right: unrelatedLiteral,
			};
		case "logical":
			return {
				nodeKind: "logical",
				operator: "and",
				operands: [unrelatedColumnRef, unrelatedLiteral],
			};
		case "not":
			return { nodeKind: "not", operand: unrelatedColumnRef };
		case "nullTest":
			return {
				nodeKind: "nullTest",
				negated: false,
				operand: unrelatedColumnRef,
			};
		case "inList":
			return {
				nodeKind: "inList",
				negated: false,
				operand: unrelatedColumnRef,
				values: [unrelatedLiteral],
			};
		case "between":
			return {
				nodeKind: "between",
				negated: false,
				operand: unrelatedColumnRef,
				lowerBound: unrelatedLiteral,
				upperBound: unrelatedLiteral,
			};
		case "functionCall":
			return {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "lower",
				args: [unrelatedColumnRef],
			};
		case "sqlTemplate":
			return {
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "text", text: "(" },
					{ chunkKind: "expr", expr: unrelatedColumnRef },
					{ chunkKind: "text", text: ")" },
				],
			};
		case "rawSql":
			return { nodeKind: "rawSql", sql: "true" };
		case "exists":
			return {
				nodeKind: "exists",
				negated: false,
				query: {
					queryKind: "select",
					projection: { projectionKind: "constantOne" },
					from: { schemaName: "app", tableName: "posts" },
					joins: [
						{
							joinKind: "inner",
							table: { schemaName: "app", tableName: "posts" },
							on: unrelatedLiteral,
						},
					],
					where: null,
					orderBy: [],
					limit: null,
				},
			};
		case "selectExpr":
			return {
				nodeKind: "selectExpr",
				mode: "jsonArray",
				query: {
					queryKind: "select",
					projection: {
						projectionKind: "columns",
						columns: [{ alias: "id", expr: unrelatedLiteral }],
					},
					from: { schemaName: "app", tableName: "posts" },
					joins: [],
					where: null,
					orderBy: [],
					limit: null,
				},
			};
		default:
			return assertNever(kind);
	}
};
