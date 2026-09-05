import { throwHejbroError } from "../error";
import type { Aggregated, ReadAs } from "./aggregate";
import type {
	AggregateFilterNode,
	Expr,
	ExprNode,
	FunctionCallNode,
	OrderTermInput,
	WindowNode,
} from "./ast";
import { resolveOrderTerm } from "./ast";
import { liftLiteral } from "./literal";

/**
 * A phantom marker (D104), never assigned at runtime — the `readAsBrand`/
 * `columnOriginBrand` precedent, same reasons. Lets {@link over}'s second
 * overload recover the exact operand type a value function
 * (`lag`/`lead`/`firstValue`/`lastValue`/`nthValue`) was built from, the
 * same way `ReadAsType` (`@hejbro/query`'s `select-result.ts`) recovers a
 * brand through a plain optional property rather than through `Omit`,
 * which does not survive generic inference. Module-private: nothing
 * outside {@link over}'s own two branches ever needs to read it.
 */
const windowOperandBrand: unique symbol = Symbol("hejbro:window-operand");

/**
 * The eleven window-only constructors' return shape (D104) — deliberately
 * missing `exprNode` (renamed `windowFn`, narrowed to a bare
 * {@link FunctionCallNode}), so a bare `rowNumber()` fails to type-check
 * everywhere an `Expr` is required (`Expr` requires `exprNode`, which this
 * type structurally lacks) until {@link over} wraps it. `family` is
 * deliberately KEPT (not also dropped): `expr/operators.ts` reads a
 * comparison operand's own `.family` at runtime to lift its other side's
 * literal correctly, and a value function's `family` must be the real
 * operand's family for that to keep working once `over()` unwraps it —
 * only `exprNode` needs to be absent for the "not an `Expr`" property to
 * hold, since `Expr` requires it as a non-optional field.
 */
export type WindowFunctionCall<TExpr extends Expr = Expr> = Omit<
	TExpr,
	"exprNode" | "sqlName"
> & {
	readonly windowFn: FunctionCallNode;
	readonly [windowOperandBrand]?: TExpr;
};

const functionCallNode = (
	functionName: string,
	args: ReadonlyArray<ExprNode>,
): FunctionCallNode => ({
	nodeKind: "functionCall",
	schemaName: null,
	functionName,
	args,
});

/**
 * Builds one value function's `WindowFunctionCall`, carrying the
 * operand's own shape through minus its `ColumnRef`-identifying fields
 * (`exprNode`/`sqlName`) — the same technique `aggregate.ts`'s
 * `aggregatedExtremum` uses for `min`/`max`, except `exprNode` must be
 * explicitly dropped here (not just overwritten): `aggregatedExtremum`
 * safely leaves a stale `exprNode` in its own spread because it always
 * replaces it under the SAME key; this function replaces it under a
 * DIFFERENT key (`windowFn`), so an undropped `exprNode` would silently
 * survive into the result and defeat the whole "not an `Expr`" point.
 */
const windowFunctionCall = <TExpr extends Expr>(
	operand: TExpr,
	functionName: string,
	args: ReadonlyArray<ExprNode>,
): WindowFunctionCall<TExpr> => {
	const {
		sqlName: _sqlName,
		exprNode: _exprNode,
		...rest
	} = operand as TExpr & {
		readonly sqlName?: string;
	};
	return {
		...rest,
		windowFn: functionCallNode(functionName, args),
	} as WindowFunctionCall<TExpr>;
};

/** `rowNumber()`/`rank()`/`denseRank()`/`percentRank()`/`cumeDist()`'s shared body — no operand, so there is no `TExpr` to carry through; `family` is always `"numeric"` (Postgres's own return type for all five). */
const bareWindowCall = (
	functionName: string,
): WindowFunctionCall<Expr<"numeric">> => ({
	family: "numeric",
	windowFn: functionCallNode(functionName, []),
});

/** `row_number()` — always `int8`; see {@link ReadAs} for why that's a brand, not a family. */
export const rowNumber = (): WindowFunctionCall<
	Expr<"numeric"> & ReadAs<bigint>
> =>
	bareWindowCall("row_number") as WindowFunctionCall<
		Expr<"numeric"> & ReadAs<bigint>
	>;

/** `rank()` — always `int8`, same reasoning as {@link rowNumber}. */
export const rank = (): WindowFunctionCall<Expr<"numeric"> & ReadAs<bigint>> =>
	bareWindowCall("rank") as WindowFunctionCall<
		Expr<"numeric"> & ReadAs<bigint>
	>;

/** `dense_rank()` — always `int8`, same reasoning as {@link rowNumber}. */
export const denseRank = (): WindowFunctionCall<
	Expr<"numeric"> & ReadAs<bigint>
> =>
	bareWindowCall("dense_rank") as WindowFunctionCall<
		Expr<"numeric"> & ReadAs<bigint>
	>;

/** `percent_rank()` — always `float8`, which already arrives as a JS number; no brand needed. */
export const percentRank = (): WindowFunctionCall<Expr<"numeric">> =>
	bareWindowCall("percent_rank");

/** `cume_dist()` — always `float8`, same reasoning as {@link percentRank}. */
export const cumeDist = (): WindowFunctionCall<Expr<"numeric">> =>
	bareWindowCall("cume_dist");

/** `ntile(buckets)` — always `int4`, which already arrives as a JS number; no brand needed. */
export const ntile = (
	buckets: number,
): WindowFunctionCall<Expr<"numeric">> => ({
	family: "numeric",
	windowFn: functionCallNode("ntile", [liftLiteral(buckets, "numeric")]),
});

/**
 * `lag`/`lead`'s shared argument list. Postgres's own signature is
 * positional (`lag(value [, offset [, default]])`), so a `default`
 * without an explicit `offset` still needs `offset` spelled out — its
 * own documented default, `1` — or `default` would be read as `offset`
 * instead.
 */
const lagLeadArgs = (
	operand: ExprNode,
	offset: number | undefined,
	defaultValue: ExprNode | undefined,
): ReadonlyArray<ExprNode> => {
	if (defaultValue !== undefined) {
		return [operand, liftLiteral(offset ?? 1, "numeric"), defaultValue];
	}
	if (offset !== undefined) {
		return [operand, liftLiteral(offset, "numeric")];
	}
	return [operand];
};

/**
 * `lag(operand, offset?, default?)` — reads back as `operand`'s own type
 * (D104, "the value functions take one signature, not two": supplying
 * `default` does not narrow the result — see the proposal for why).
 */
export const lag = <TExpr extends Expr>(
	operand: TExpr,
	offset?: number,
	defaultValue?: TExpr,
): WindowFunctionCall<TExpr> =>
	windowFunctionCall(
		operand,
		"lag",
		lagLeadArgs(operand.exprNode, offset, defaultValue?.exprNode),
	);

/** `lead(operand, offset?, default?)` — same typing rule as {@link lag}. */
export const lead = <TExpr extends Expr>(
	operand: TExpr,
	offset?: number,
	defaultValue?: TExpr,
): WindowFunctionCall<TExpr> =>
	windowFunctionCall(
		operand,
		"lead",
		lagLeadArgs(operand.exprNode, offset, defaultValue?.exprNode),
	);

/** `first_value(operand)` — reads back as `operand`'s own type. */
export const firstValue = <TExpr extends Expr>(
	operand: TExpr,
): WindowFunctionCall<TExpr> =>
	windowFunctionCall(operand, "first_value", [operand.exprNode]);

/** `last_value(operand)` — same typing rule as {@link firstValue}. */
export const lastValue = <TExpr extends Expr>(
	operand: TExpr,
): WindowFunctionCall<TExpr> =>
	windowFunctionCall(operand, "last_value", [operand.exprNode]);

/** `nth_value(operand, n)` — reads back as `operand`'s own type. */
export const nthValue = <TExpr extends Expr>(
	operand: TExpr,
	n: number,
): WindowFunctionCall<TExpr> =>
	windowFunctionCall(operand, "nth_value", [
		operand.exprNode,
		liftLiteral(n, "numeric"),
	]);

/**
 * `over()`'s window specification — `partitionBy`/`orderBy` (D104), using
 * the same {@link OrderTermInput} shape (and its {@link resolveOrderTerm}
 * resolver) a select's own `orderBy()` uses — promoted to `expr/ast.ts`
 * in group 3 once this module became a second real consumer, closing a
 * hand-kept duplicate this file originally carried locally.
 */
export type WindowSpec = {
	readonly partitionBy?: ReadonlyArray<Expr>;
	readonly orderBy?: ReadonlyArray<OrderTermInput>;
};

const buildWindowNode = (
	fn: FunctionCallNode | AggregateFilterNode,
	spec: WindowSpec,
): WindowNode => ({
	nodeKind: "window",
	fn,
	partitionBy: (spec.partitionBy ?? []).map((column) => column.exprNode),
	orderBy: (spec.orderBy ?? []).map(resolveOrderTerm),
});

/**
 * `true` for a {@link WindowFunctionCall} — it alone carries `windowFn`;
 * a real `Expr` never does, and (by construction) a `WindowFunctionCall`
 * never carries `exprNode`. Untyped as a predicate on purpose: a
 * predicate here would narrow `over()`'s generic union parameter to the
 * guard's OWN declared type (`WindowFunctionCall<Expr>`, losing the tie
 * to `TExpr`), not to the original `WindowFunctionCall<TExpr>` union
 * member — `over()` casts explicitly at each call site instead, the same
 * "trust the runtime check, cast past what narrowing can't express"
 * idiom `render-sql.ts`'s handler-map dispatchers already use.
 */
const hasWindowFn = (target: object): boolean => "windowFn" in target;

const throwInvalidOverTarget = (): never =>
	throwHejbroError(
		"invalid-over-target",
		"over() requires a function call -- an existing aggregate (sum(), count(), min(), max(), avg()), a filtered aggregate (filter(count(), condition)), or one of the window-only constructors (rowNumber(), rank(), lag(), ...). Next: wrap one of those, or drop over() if this expression isn't a window function.",
	);

/**
 * `over()`'s aggregate-target branch: `target` must already render as a
 * function call or a filtered aggregate (#501/R2 Q2, #501/R3) — Postgres's
 * own requirement, a window clause attaches to a function call (filtered
 * or not), nothing else.
 */
const overAggregate = <TExpr extends Expr>(
	target: TExpr,
	spec: WindowSpec,
): Aggregated<TExpr> => {
	if (
		target.exprNode.nodeKind !== "functionCall" &&
		target.exprNode.nodeKind !== "aggregateFilter"
	) {
		return throwInvalidOverTarget();
	}
	const {
		sqlName: _sqlName,
		exprNode: _exprNode,
		...rest
	} = target as TExpr & {
		readonly sqlName?: string;
	};
	return {
		...rest,
		exprNode: buildWindowNode(target.exprNode, spec),
	} as Aggregated<TExpr>;
};

/** `over()`'s window-only-call branch: `call.windowFn` is already known to be a function call by construction (every one of the eleven constructors builds one), so there is nothing to validate here. */
const overWindowFunctionCall = <TExpr extends Expr>(
	call: WindowFunctionCall<TExpr>,
	spec: WindowSpec,
): Aggregated<TExpr> => {
	const { windowFn, ...rest } = call as WindowFunctionCall<TExpr> &
		Record<string, unknown>;
	return {
		...rest,
		exprNode: buildWindowNode(windowFn as FunctionCallNode, spec),
	} as Aggregated<TExpr>;
};

/**
 * Attaches a window specification to an existing aggregate or one of the
 * eleven window-only constructors (D104) — the sole way to turn either
 * into a usable `Expr`. Rendered as `<target>(...) over (partition by …
 * order by …)`, both sub-clauses omitted when empty. One generic
 * function over a union parameter, not two `tsc`-level overloads: a
 * `function over(...): ...; function over(...): ...;` overload pair
 * failed its own implementation-compatibility check here (`TS2394`) once
 * the second overload's parameter went through `WindowFunctionCall`'s
 * `Omit`-based shape — a union parameter infers `TExpr` from either
 * branch just as well and matches the proposal's own description ("one
 * wrapper covering both inputs") more directly than two signatures would.
 */
export const over = <TExpr extends Expr>(
	target: TExpr | WindowFunctionCall<TExpr>,
	spec: WindowSpec,
): Aggregated<TExpr> => {
	if (hasWindowFn(target)) {
		return overWindowFunctionCall(target as WindowFunctionCall<TExpr>, spec);
	}
	return overAggregate(target as TExpr, spec);
};
