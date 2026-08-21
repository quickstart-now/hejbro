import type {
	Diagnostic,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	PolicyDeclaration,
	SelectNode,
	Validator,
} from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
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

/** `query.where`, as a 0-or-1-element array — no ternary, just an early return either way. */
const whereClauseOf = (query: SelectNode): ReadonlyArray<ExprNode> => {
	if (query.where === null) {
		return [];
	}
	return [query.where];
};

/**
 * An `exists(...)` node's child expressions: its `where` clause, each
 * join's `on` condition, and each `orderBy` term's expression. Split out
 * from {@link childrenOf} (a separate module-scope function, not a nested
 * one) to keep both functions' own complexity low (D71).
 *
 * Deliberately descends into these, unlike core's own `someExprNode`
 * (`packages/core/src/expr/walk.ts`), which treats `exists` as opaque —
 * a different concern, column-reference scope checking. For this
 * validator's purpose, a subquery's predicate is evaluated once per outer
 * row exactly like the policy's own clause is, so `auth.uid()` inside
 * `exists(select(...).where(eq(profiles.userId, authUid())))` is exactly
 * as expensive as one directly in `using(...)` — and this is the common
 * real shape: `examples/supabase`'s own policies hit this path twice out
 * of the three real uncached calls.
 *
 * `orderBy` is walked for the same reason, not skipped: `exists()`
 * (`buildExists` in `packages/core/src/query/select.ts`) only overrides
 * the subquery's `projection` to `constantOne` -- it does not clear
 * `orderBy`, so a term set via the public `.orderBy(...)` builder before
 * `exists(...)` wraps the query survives into the persisted `ExistsNode`
 * untouched. Confirmed directly: `exists(select(t).where(...).orderBy(
 * authUid()))` produces an `ExistsNode` whose `query.orderBy[0].expr` is
 * the same uncached `functionCall` node an unwalked `orderBy` would miss
 * warning about, even though it's meaningless for what `EXISTS` actually
 * returns.
 *
 * Projection *is* skipped, and that omission is the one that's actually
 * unreachable: `buildExists` always replaces `projection` with the fixed
 * `constantOne` shape (D70) before the query becomes an `ExistsNode`, so
 * there is no path through the public DSL for an expression -- cached or
 * not -- to end up in an `exists()` subquery's projection at all.
 */
const childrenOfExists = (node: ExistsNode): ReadonlyArray<ExprNode> => [
	...whereClauseOf(node.query),
	...node.query.joins.map((join) => join.on),
	...node.query.orderBy.map((term) => term.expr),
];

/** `comparison`/`not`/`nullTest`'s fixed-arity children — the other half of {@link childrenOf}'s switch, split out to keep each half's own complexity low (D71). */
const childrenOfFixedArity = (node: ExprNode): ReadonlyArray<ExprNode> => {
	switch (node.nodeKind) {
		case "comparison":
			return [node.left, node.right];
		case "not":
		case "nullTest":
			return [node.operand];
		default:
			return [];
	}
};

/** `logical`/`inList`/`between`/`functionCall`/`sqlTemplate`'s variable-arity children — the other half, see {@link childrenOfFixedArity}. */
const childrenOfVariableArity = (node: ExprNode): ReadonlyArray<ExprNode> => {
	switch (node.nodeKind) {
		case "logical":
			return node.operands;
		case "inList":
			return [node.operand, ...node.values];
		case "between":
			return [node.operand, node.lowerBound, node.upperBound];
		case "functionCall":
			return node.args;
		case "sqlTemplate":
			return node.chunks
				.filter((chunk) => chunk.chunkKind === "expr")
				.map((chunk) => chunk.expr);
		default:
			return [];
	}
};

/**
 * `node`'s immediate child expressions, for the walk below. Extracted to
 * its own module-scope function (not nested) to keep its own complexity
 * low (D71) rather than folding the whole traversal into one function —
 * the same "children lookup" split core's own `someExprNode` doesn't need
 * but this validator does, since core's version isn't part of the public
 * API surface and can't be imported here. Delegates to
 * {@link childrenOfExists}/{@link childrenOfFixedArity}/
 * {@link childrenOfVariableArity}, each covering a disjoint subset of
 * `nodeKind`s, so at most one of the three ever returns anything for a
 * given node.
 */
const childrenOf = (node: ExprNode): ReadonlyArray<ExprNode> => {
	if (node.nodeKind === "exists") {
		return childrenOfExists(node);
	}
	return [...childrenOfFixedArity(node), ...childrenOfVariableArity(node)];
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
