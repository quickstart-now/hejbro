import { throwHejbroError } from "../error";
import type { ComparisonOperator, Expr, ExprNode } from "./ast";
import { expr } from "./ast";
import { liftOperand } from "./literal";
import type { LiftableFor, SqlTypeFamily } from "./type-family";

/** An operand accepted by a typed operator: a matching `Expr`, an `unknown`-family `Expr` (e.g. from `sql\`…\``), or a raw JS value that auto-lifts to a literal. */
type Operand<TFamily extends SqlTypeFamily> =
	| Expr<TFamily>
	| Expr<"unknown">
	| LiftableFor<TFamily>;

/** Lifts `value` for `family`, rejecting a lifted SQL `null` — `eq(x, null)`/`ne(x, null)` never behave as intended in SQL. */
const liftOperandOrRejectNull = (
	value: unknown,
	family: SqlTypeFamily,
): ExprNode => {
	const lifted = liftOperand(value, family);
	if (lifted.nodeKind === "literal" && lifted.literal.literalKind === "null") {
		return throwHejbroError(
			"null-comparison",
			"eq()/ne() with null always yields SQL null, never true — use isNull()/isNotNull() instead.",
		);
	}
	return lifted;
};

const comparison =
	(operator: ComparisonOperator) =>
	<TFamily extends SqlTypeFamily>(
		left: Expr<TFamily>,
		right: Operand<TFamily>,
	): Expr<"boolean"> =>
		expr("boolean", {
			nodeKind: "comparison",
			operator,
			left: left.exprNode,
			right: liftOperandOrRejectNull(right, left.family),
		});

export const eq = comparison("=");
export const ne = comparison("<>");
export const gt = comparison(">");
export const gte = comparison(">=");
export const lt = comparison("<");
export const lte = comparison("<=");

export const like: (
	left: Expr<"text">,
	pattern: Operand<"text">,
) => Expr<"boolean"> = comparison("like");
export const ilike: (
	left: Expr<"text">,
	pattern: Operand<"text">,
) => Expr<"boolean"> = comparison("ilike");
export const notLike: (
	left: Expr<"text">,
	pattern: Operand<"text">,
) => Expr<"boolean"> = comparison("not like");
export const notIlike: (
	left: Expr<"text">,
	pattern: Operand<"text">,
) => Expr<"boolean"> = comparison("not ilike");

export const isNull = (operand: Expr): Expr<"boolean"> =>
	expr("boolean", {
		nodeKind: "nullTest",
		negated: false,
		operand: operand.exprNode,
	});

export const isNotNull = (operand: Expr): Expr<"boolean"> =>
	expr("boolean", {
		nodeKind: "nullTest",
		negated: true,
		operand: operand.exprNode,
	});

const logical =
	(operator: "and" | "or") =>
	(...conditions: ReadonlyArray<Expr<"boolean">>): Expr<"boolean"> => {
		if (conditions.length === 0) {
			return throwHejbroError(
				"empty-logical-expression",
				"and()/or() need at least one operand — pass at least one boolean expression.",
			);
		}
		return expr("boolean", {
			nodeKind: "logical",
			operator,
			operands: conditions.map((condition) => condition.exprNode),
		});
	};

export const and = logical("and");
export const or = logical("or");

export const not = (condition: Expr<"boolean">): Expr<"boolean"> =>
	expr("boolean", { nodeKind: "not", operand: condition.exprNode });

const inList =
	(negated: boolean) =>
	<TFamily extends SqlTypeFamily>(
		operand: Expr<TFamily>,
		values: ReadonlyArray<Operand<TFamily>>,
	): Expr<"boolean"> =>
		expr("boolean", {
			nodeKind: "inList",
			negated,
			operand: operand.exprNode,
			values: values.map((value) => liftOperand(value, operand.family)),
		});

export const inArray = inList(false);
export const notInArray = inList(true);

const betweenFactory =
	(negated: boolean) =>
	<TFamily extends SqlTypeFamily>(
		operand: Expr<TFamily>,
		lowerBound: Operand<TFamily>,
		upperBound: Operand<TFamily>,
	): Expr<"boolean"> =>
		expr("boolean", {
			nodeKind: "between",
			negated,
			operand: operand.exprNode,
			lowerBound: liftOperand(lowerBound, operand.family),
			upperBound: liftOperand(upperBound, operand.family),
		});

export const between = betweenFactory(false);
export const notBetween = betweenFactory(true);

export const now = (): Expr<"datetime"> =>
	expr("datetime", {
		nodeKind: "functionCall",
		schemaName: null,
		functionName: "now",
		args: [],
	});

export const genRandomUuid = (): Expr<"uuid"> =>
	expr("uuid", {
		nodeKind: "functionCall",
		schemaName: null,
		functionName: "gen_random_uuid",
		args: [],
	});

export const coalesce = <TFamily extends SqlTypeFamily>(
	first: Expr<TFamily>,
	...rest: ReadonlyArray<Operand<TFamily>>
): Expr<TFamily> =>
	expr(first.family, {
		nodeKind: "functionCall",
		schemaName: null,
		functionName: "coalesce",
		args: [
			first.exprNode,
			...rest.map((value) => liftOperand(value, first.family)),
		],
	});
