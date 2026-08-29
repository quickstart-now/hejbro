import type { Expr, ExprNode } from "./ast";
import { expr } from "./ast";

/**
 * A phantom read-type brand (#416). An expression normally resolves to
 * its SQL family widened — the widest honest type, because a family
 * collapses several declared types together. An aggregate is the
 * exception: `count` is `bigint` and nothing else, whatever its argument
 * was, so the type it reads back as is known exactly and the family
 * would be a needless widening.
 *
 * Optional and never assigned at runtime — the `columnOriginBrand`
 * precedent, same reasons. `@hejbro/query`'s select-result inference
 * reads it the same way it reads the origin brand.
 */
export const readAsBrand: unique symbol = Symbol("hejbro:read-as");

/** The brand's shape — see {@link readAsBrand}. */
export type ReadAs<T> = { readonly [readAsBrand]?: T };

/**
 * The aggregate vocabulary. Postgres's own names, rendered verbatim —
 * these are SQL keywords, not hejbro-authored tokens (D57).
 *
 * Only `count` carries a {@link ReadAs} brand. `min`/`max` return their
 * argument's own type, which is more precise than any brand could be.
 * `sum`/`avg` deliberately do not: Postgres promotes their result by the
 * argument's exact type (`sum(int4)` is `int8`, `sum(int8)` is
 * `numeric`, `avg(int)` is `numeric`, `avg(float8)` is `float8`), so a
 * single brand would be a lie for most inputs — they stay at the numeric
 * family's widest honest type until that promotion table is worth
 * building.
 */
const aggregate = (
	functionName: string,
	args: ReadonlyArray<ExprNode>,
): ExprNode => ({
	nodeKind: "functionCall",
	schemaName: null,
	functionName,
	args,
});

/** `count(*)` — the number of rows in the group. Always `bigint`: Postgres's `count` is `int8` regardless of what it counted. */
export const count = (): Expr<"numeric"> & ReadAs<bigint> =>
	expr("numeric", aggregate("count", [{ nodeKind: "rawSql", sql: "*" }]));

/** `count(<expr>)` — rows where the expression is not null. */
export const countWhere = (operand: Expr): Expr<"numeric"> & ReadAs<bigint> =>
	expr("numeric", aggregate("count", [operand.exprNode]));

/**
 * `min`/`max`'s return type: the argument's own read type (`family`,
 * `typeNode`, any `.$type<T>()` brand carried on `typeNode`) but not its
 * ColumnRef-ness (#444 F9) — the returned expression's `exprNode` is a
 * `functionCall`, so keeping `exprNode: ColumnRefNode`/`sqlName` (a
 * `ColumnRef`'s two identifying fields, `ast.ts`) would be a lie a
 * declaration API acting on `"sqlName" in x` (`dsl/index-builder.ts`'s
 * `isColumnRef`) or requiring a real `ColumnRef` (`ForeignKeyInput.
 * columns`, `dsl/table.ts`) could act on before ever reaching a
 * mismatched runtime shape. `Omit` drops both; nothing else about
 * `TExpr` is required to be a `ColumnRef` in the first place, so
 * `max(max(x))` and a plain non-`ColumnRef` `Expr` argument both still
 * type-check.
 */
export type Aggregated<TExpr extends Expr> = Omit<
	TExpr,
	"exprNode" | "sqlName"
> & {
	readonly exprNode: ExprNode;
};

/** `min`/`max`'s shared body — one runtime rebuild (drops `sqlName`, not just its type) for both, keyed by which Postgres function name to render. */
const aggregatedExtremum = <TExpr extends Expr>(
	functionName: "min" | "max",
	operand: TExpr,
): Aggregated<TExpr> => {
	const { sqlName: _sqlName, ...rest } = operand as TExpr & {
		readonly sqlName?: string;
	};
	return {
		...rest,
		exprNode: aggregate(functionName, [operand.exprNode]),
	} as Aggregated<TExpr>;
};

/** `min(<expr>)` — reads back as whatever the argument reads back as, which is exactly what Postgres's own `min` returns; see {@link Aggregated} for the exact typing rule. */
export const min = <TExpr extends Expr>(operand: TExpr): Aggregated<TExpr> =>
	aggregatedExtremum("min", operand);

/** `max(<expr>)` — same typing rule as {@link min}. */
export const max = <TExpr extends Expr>(operand: TExpr): Aggregated<TExpr> =>
	aggregatedExtremum("max", operand);

/** `sum(<expr>)`. See {@link aggregate} for why this carries no read-type brand. */
export const sum = (operand: Expr): Expr<"numeric"> =>
	expr("numeric", aggregate("sum", [operand.exprNode]));

/** `avg(<expr>)`. See {@link aggregate} for why this carries no read-type brand. */
export const avg = (operand: Expr): Expr<"numeric"> =>
	expr("numeric", aggregate("avg", [operand.exprNode]));
