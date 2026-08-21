import type { Expr } from "@hejbro/core";
import { expr } from "@hejbro/core";

/**
 * `auth.uid()` — the calling user's id (uuid), as Supabase's `auth` schema
 * exposes it. Renders the plain call (D45): no automatic
 * `(select auth.uid())` initPlan wrapping, since that wrapping is illegal
 * inside a column `default`/`check` expression, where this helper is also
 * idiomatic. Use this form there; use {@link authUidCached} in RLS
 * policies instead (#97) — see the package README for the performance
 * rationale.
 */
export const authUid = (): Expr<"uuid"> =>
	expr("uuid", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "uid",
		args: [],
	});

/** `auth.jwt()` — the calling user's JWT claims (jsonb), as Supabase's `auth` schema exposes it. Same plain-vs-cached split as {@link authUid} / {@link authJwtCached} (#97). */
export const authJwt = (): Expr<"json"> =>
	expr("json", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "jwt",
		args: [],
	});

/**
 * `(select auth.uid())` — the initPlan-cached form of {@link authUid} (#97).
 * A bare `auth.uid()` in an RLS `using`/`withCheck` clause is re-evaluated
 * once per row; Postgres caches a scalar subquery's result as an initPlan
 * and evaluates it once per statement instead — the standard Supabase RLS
 * performance guidance. Use this in policies. **Do not** use it in a column
 * `default`/`check` expression: a scalar subquery is illegal there
 * (`check-subquery` already hard-errors on this for `.check(...)`), and
 * {@link authUid} is the correct, idiomatic form in that position.
 *
 * Reuses the existing `rawSql` node (D68/D71: no new `ExprNode` kind), the
 * same way {@link authUid} reuses `functionCall` — just with `expr()`
 * called directly instead of through the public `sql` template tag, since
 * `sql.raw()` returns `Expr<"unknown">` and this needs `Expr<"uuid">` to
 * drop into a `uuid` column comparison without a cast.
 */
export const authUidCached = (): Expr<"uuid"> =>
	expr("uuid", { nodeKind: "rawSql", sql: "(select auth.uid())" });

/**
 * `(select auth.jwt())` — the initPlan-cached form of {@link authJwt} (#97).
 * See {@link authUidCached}: same caching rationale, same "policies yes,
 * column `default`/`check` no" placement rule, same `rawSql` reuse.
 */
export const authJwtCached = (): Expr<"json"> =>
	expr("json", { nodeKind: "rawSql", sql: "(select auth.jwt())" });
