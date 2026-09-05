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
	exprChildren,
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
 * `node`'s immediate child expressions, for the walk below. A node kind's
 * own child positions are core's exported registry to own, not this
 * file's (#515) -- this validator keeps only the one decision that is
 * its own: `exists`/`selectExpr` descend into the subquery via core's
 * {@link existsChildExprs}/{@link selectExprChildExprs} rather than
 * treating it as opaque the way {@link exprChildren} deliberately does,
 * because a subquery's predicate is evaluated once per outer row exactly
 * like the policy's own clause is (#444 F5b) -- `auth.uid()` inside
 * `exists(select(...).where(eq(profiles.userId, authUid())))` is exactly
 * as expensive as one directly in `using(...)`, the common real shape
 * (`examples/supabase`'s own policies hit this path twice out of the
 * three real uncached calls). Every other kind walks {@link exprChildren}.
 */
const childrenOf = (node: ExprNode): ReadonlyArray<ExprNode> => {
	if (node.nodeKind === "exists") {
		return existsChildExprs(node);
	}
	if (node.nodeKind === "selectExpr") {
		return selectExprChildExprs(node);
	}
	return exprChildren(node);
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
