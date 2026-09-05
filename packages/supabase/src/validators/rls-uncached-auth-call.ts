import type {
	Diagnostic,
	ExprNode,
	FunctionCallNode,
	PolicyDeclaration,
	Validator,
} from "@hejbro/core";
import {
	diagnostic,
	existsChildExprs,
	selectExprChildExprs,
} from "@hejbro/core";
import { declaredAtOf, isPolicyDeclaration } from "./schema-of";

/** The two `auth` schema functions with an initPlan-cached form (#97). */
type CachableAuthFunctionName = "uid" | "jwt";

type UncachedAuthCallNode = FunctionCallNode & {
	readonly functionName: CachableAuthFunctionName;
};

const isCachableAuthFunctionName = (
	name: string,
): name is CachableAuthFunctionName => name === "uid" || name === "jwt";

/**
 * A plain (uncached) `auth.uid()`/`auth.jwt()` call — not `authUidCached()`/
 * `authJwtCached()`, which render as a `rawSql` node, not `functionCall`.
 */
const isUncachedAuthCall = (node: ExprNode): node is UncachedAuthCallNode =>
	node.nodeKind === "functionCall" &&
	node.schemaName === "auth" &&
	isCachableAuthFunctionName(node.functionName);

/**
 * One handler per {@link ExprNode} `nodeKind`, receiving the node narrowed
 * to that exact variant — same technique core's own `someExprNodeHandlers`
 * uses (`packages/core/src/expr/walk.ts`): a mapped type over the full
 * `nodeKind` union, not a hand-written list, so the object literal below
 * must cover every key — a missing one is a compile error, the same
 * guarantee a `switch`'s `default: assertNever(node)` gives at runtime.
 * Replaces the two former `childrenOfFixedArity`/`childrenOfVariableArity`
 * switches (#154 ratchet-5): each entry here is its own object-literal
 * function the CRAP tool scores independently (see `scripts/check-crap.mjs`'s
 * own file comment), so splitting by `nodeKind` this way doesn't just move
 * the switch's branch count around, it removes it — every entry below has
 * no branches of its own.
 */
type ChildrenOfHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
	) => ReadonlyArray<ExprNode>;
};

/**
 * `exists`/`selectExpr` descend via core's own {@link existsChildExprs}/
 * {@link selectExprChildExprs} (#444 F5b) rather than a private copy of
 * the same walk — deliberately, unlike core's own `someExprNode`
 * (`packages/core/src/expr/walk.ts`), which treats `exists` as opaque (a
 * different concern, column-reference scope checking). For this
 * validator's purpose, a subquery's predicate is evaluated once per
 * outer row exactly like the policy's own clause is, so `auth.uid()`
 * inside `exists(select(...).where(eq(profiles.userId, authUid())))` is
 * exactly as expensive as one directly in `using(...)` — the common real
 * shape: `examples/supabase`'s own policies hit this path twice out of
 * the three real uncached calls. A nested read's (`selectExpr`)
 * projection carries real expressions (never `constantOne`), so it is
 * walked too; an `exists()` subquery's projection is always
 * `constantOne` (D70's `buildExists`) and contributes nothing either
 * way — see `existsChildExprs`'s own doc comment for why reusing the
 * wider `selectExprChildExprs` list is still correct there.
 */
const childrenOfHandlers: ChildrenOfHandlers = {
	literal: () => [],
	rawSql: () => [],
	plpgsqlRef: () => [],
	columnRef: () => [],
	comparison: (node) => [node.left, node.right],
	not: (node) => [node.operand],
	nullTest: (node) => [node.operand],
	logical: (node) => node.operands,
	inList: (node) => [node.operand, ...node.values],
	between: (node) => [node.operand, node.lowerBound, node.upperBound],
	functionCall: (node) => node.args,
	sqlTemplate: (node) =>
		node.chunks
			.filter((chunk) => chunk.chunkKind === "expr")
			.map((chunk) => chunk.expr),
	exists: existsChildExprs,
	selectExpr: selectExprChildExprs,
	// `window`'s three positions (fn/partitionBy/orderBy) are plain sibling
	// expressions, not a subquery -- an auth.uid() hidden in any of them is
	// exactly as expensive as one directly in the clause, same as a plain
	// `functionCall`'s own args above.
	window: (node) => [
		node.fn,
		...node.partitionBy,
		...node.orderBy.map((term) => term.expr),
	],
	// A filtered aggregate's two positions (#501) are plain sibling
	// expressions too, not a subquery -- same reasoning as `window` above.
	aggregateFilter: (node) => [node.fn, node.where],
};

/**
 * `node`'s immediate child expressions, for the walk below. Extracted to
 * its own module-scope function (not nested) to keep its own complexity
 * low (D71) rather than folding the whole traversal into one function —
 * the same "children lookup" split core's own `someExprNode` doesn't
 * need but this validator does: `someDeepExprNode`/`someExprNode` answer
 * "does a match exist anywhere", this validator needs the actual
 * matched node (its `functionName`, for the diagnostic message), which
 * is a different shape of walk. `exists`/`selectExpr` no longer carry a
 * private copy of core's own traversal (#444 F5b) — see {@link
 * childrenOfHandlers}'s own doc comment. Dispatches through {@link
 * childrenOfHandlers}, a closed map keyed by `nodeKind`.
 */
const childrenOf = (node: ExprNode): ReadonlyArray<ExprNode> => {
	const handler = childrenOfHandlers[node.nodeKind] as (
		node: ExprNode,
	) => ReadonlyArray<ExprNode>;
	return handler(node);
};

/** Depth-first search for the first uncached `auth.uid()`/`auth.jwt()` call anywhere in `node`'s tree. */
const findUncachedAuthCall = (node: ExprNode): UncachedAuthCallNode | null => {
	if (isUncachedAuthCall(node)) {
		return node;
	}
	return childrenOf(node).reduce<UncachedAuthCallNode | null>(
		(found, child) => found ?? findUncachedAuthCall(child),
		null,
	);
};

const cachedFormFor: Record<CachableAuthFunctionName, string> = {
	uid: "authUidCached()",
	jwt: "authJwtCached()",
};

const uncachedAuthCallMessage = (
	policy: PolicyDeclaration,
	clause: "using" | "with check",
	functionName: CachableAuthFunctionName,
): string =>
	`policy "${policy.policyName}" on "${policy.schemaName}"."${policy.tableName}"'s ${clause} clause calls the plain auth.${functionName}() — Postgres re-evaluates it once per row instead of caching it as an initPlan evaluated once per statement. Next: use ${cachedFormFor[functionName]} here.`;

/** Diagnostics for one clause (`using` or `with check`) of one policy — `[]` when the clause is absent or already cached. */
const clauseDiagnostics = (
	policy: PolicyDeclaration,
	clause: "using" | "with check",
	node: ExprNode | null,
): ReadonlyArray<Diagnostic> => {
	if (node === null) {
		return [];
	}
	const match = findUncachedAuthCall(node);
	if (match === null) {
		return [];
	}
	return [
		diagnostic(
			"warning",
			"rls-uncached-auth-call",
			uncachedAuthCallMessage(policy, clause, match.functionName),
			declaredAtOf(policy),
		),
	];
};

/**
 * Warns when an RLS policy's `using`/`with check` clause calls the plain
 * `auth.uid()`/`auth.jwt()` instead of the initPlan-cached
 * `authUidCached()`/`authJwtCached()` (#97) — the standard Supabase RLS
 * performance guidance. Scoped to policies only: a column `default`/`check`
 * expression is a different, correct place for the plain form (a scalar
 * subquery is illegal there — `check-subquery` already hard-errors on this
 * for `.check(...)`), so this validator does not look at those at all.
 */
export const rlsUncachedAuthCallValidator: Validator = (
	_snapshot,
	declarations,
) =>
	declarations
		.filter(isPolicyDeclaration)
		.flatMap((policy) => [
			...clauseDiagnostics(policy, "using", policy.using),
			...clauseDiagnostics(policy, "with check", policy.withCheck),
		]);
