import type { Expr, ExprNode, SqlInterpolation } from "@hejbro/core";
import { sql as coreSql, quoteIdentifier } from "@hejbro/core";

/**
 * A `sql` result usable two ways: as an `Expr<"unknown">` embedded inside
 * a larger statement (a fragment), and as `statementExpr` — the whole
 * thing compiled standalone via `compile()` (a statement). One value,
 * two uses (owner-settled `sql` escape hatch contract, 2026-08-26).
 */
export type SqlExpr = Expr<"unknown"> & { readonly statementExpr: ExprNode };

const withStatementExpr = (expr: Expr<"unknown">): SqlExpr => ({
	...expr,
	statementExpr: expr.exprNode,
});

type SqlTag = {
	(
		strings: TemplateStringsArray,
		...values: ReadonlyArray<SqlInterpolation>
	): SqlExpr;
	/**
	 * The single verbatim path into the compiled SQL text — in both
	 * declaration and query media. The caller is responsible for what it
	 * passes here; nothing else in this package renders caller text
	 * uninterpreted.
	 */
	raw(rawSql: string): SqlExpr;
	/**
	 * Quotes each part through core's identifier rule and joins them with
	 * `.` — `sql.identifier("app", "posts")` renders `"app"."posts"`.
	 * Interpolating a `Table` directly is deferred past v1.
	 */
	identifier(...names: ReadonlyArray<string>): Expr<"unknown">;
};

const sqlTag = (
	strings: TemplateStringsArray,
	...values: ReadonlyArray<SqlInterpolation>
): SqlExpr => withStatementExpr(coreSql(strings, ...values));

const raw = (rawSql: string): SqlExpr => withStatementExpr(coreSql.raw(rawSql));

const identifier = (...names: ReadonlyArray<string>): Expr<"unknown"> =>
	coreSql.raw(names.map((name) => quoteIdentifier(name)).join("."));

/**
 * Typed `sql` escape hatch. A thin wrapper that delegates every fragment
 * semantic to core's own `sql` tag — this module never assembles a
 * `SqlTemplateNode`/`RawSqlNode` itself, so fragment behavior (structural
 * nesting, interpolation rules) is identical to a declaration's `sql` by
 * construction, and core stays untouched.
 *
 * Interpolated values become bind parameters when compiled as part of a
 * query (never inlined literals); the same fragment written into a
 * declaration renders those values inline instead, because migration SQL
 * must stay readable/diffable — one fragment, medium-dependent rendering.
 */
export const sql: SqlTag = Object.assign(sqlTag, { raw, identifier });
