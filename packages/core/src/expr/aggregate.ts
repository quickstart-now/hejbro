import { throwHejbroError } from "../error";
import type { Expr, ExprNode } from "./ast";
import { expr } from "./ast";
import { someExprNode } from "./walk";

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
 * Rejects an aggregate argument containing a window function (D104) —
 * Postgres's own separate rule (`42803`, "aggregate function calls
 * cannot contain window function calls"), a different class from
 * `window-function-not-allowed`'s placement rule (`42P20`), so it gets
 * its own code rather than collapsing two rules into one. The type
 * system already blocks a bare window-only call here (it has no
 * `exprNode`); this catches the shape that DOES type-check —
 * `over(rank(), spec)` returns a real `Expr`, so `sum(over(rank(), …))`
 * compiles and needs its own runtime check, same as `where`/`having`
 * needed one for the same reason. The forward nesting (a window
 * function's own argument containing another window function) needs no
 * check at all: `WindowNode.fn: FunctionCallNode` makes it
 * unrepresentable, not merely rejected.
 */
const assertNoWindowedArgument = (args: ReadonlyArray<ExprNode>): void => {
	if (
		args.some((arg) => someExprNode(arg, (node) => node.nodeKind === "window"))
	) {
		throwHejbroError(
			"windowed-aggregate-argument",
			"an aggregate's argument cannot contain a window function — Postgres evaluates window functions after aggregation runs, so its result isn't available to the aggregate yet. Next: wrap the aggregate itself in over(...) instead (e.g. over(sum(t.amount), spec)), or restructure with a subquery.",
		);
	}
};

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
): ExprNode => {
	assertNoWindowedArgument(args);
	return {
		nodeKind: "functionCall",
		schemaName: null,
		functionName,
		args,
	};
};

/**
 * `count()` — the number of rows in the group — or `count(<expr>)` — rows
 * where `<expr>` is not null (Postgres's own `count(x)` semantics, #469:
 * the invented name this file used to carry for the argumented form
 * borrowed `FILTER`'s meaning instead — removed rather than renamed,
 * since this file's own rule is that all five aggregate names carry
 * Postgres's own names verbatim). Always `bigint`: Postgres's `count` is
 * `int8` regardless of what it counted, argumented or not.
 */
export const count = (operand?: Expr): Expr<"numeric"> & ReadAs<bigint> =>
	expr(
		"numeric",
		aggregate("count", [operand?.exprNode ?? { nodeKind: "rawSql", sql: "*" }]),
	);

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
