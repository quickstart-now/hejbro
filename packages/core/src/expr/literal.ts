import { assertNever, throwHejbroError } from "../error";
import { quoteStringLiteral } from "../sql/literal";
import type { ExprNode, LiteralNode } from "./ast";
import { isExpr } from "./ast";
import type { SqlTypeFamily } from "./type-family";

const describeAmbiguousKind = (value: object): string => {
	if (Array.isArray(value)) {
		return "array";
	}
	return "object";
};

const rejectAmbiguousLiteral = (value: object): never => {
	const kind = describeAmbiguousKind(value);
	return throwHejbroError(
		"ambiguous-literal",
		`got a plain ${kind} — hejbro cannot infer whether this is a Postgres array or jsonb; wrap it explicitly (e.g. sql\`…\`) or pass a scalar.`,
	);
};

/**
 * Validates and narrows a JS value into a {@link LiteralNode} renderable as
 * SQL. `family` is currently only used by callers to describe intent — the
 * runtime shape of `value` decides the literal kind.
 */
export const liftLiteral = (
	value: unknown,
	_family: SqlTypeFamily,
): LiteralNode => {
	if (typeof value === "string") {
		return { nodeKind: "literal", literal: { literalKind: "string", value } };
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			return throwHejbroError(
				"invalid-literal",
				`${value} is not a finite number — SQL numeric literals must be finite; compute the value before declaring it.`,
			);
		}
		return { nodeKind: "literal", literal: { literalKind: "number", value } };
	}
	if (typeof value === "boolean") {
		return { nodeKind: "literal", literal: { literalKind: "boolean", value } };
	}
	if (value === null) {
		return { nodeKind: "literal", literal: { literalKind: "null" } };
	}
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			return throwHejbroError(
				"invalid-literal",
				`invalid Date — SQL timestamp literals need a valid date; check how this value was constructed.`,
			);
		}
		return {
			nodeKind: "literal",
			literal: { literalKind: "timestamp", isoValue: value.toISOString() },
		};
	}
	if (typeof value === "object") {
		return rejectAmbiguousLiteral(value);
	}
	return throwHejbroError(
		"invalid-literal",
		`got a ${typeof value} — hejbro cannot lift this into a SQL literal; pass a string, number, boolean, null, or Date.`,
	);
};

/**
 * Returns `value.exprNode` when `value` is already an {@link Expr}, otherwise
 * lifts the raw JS value into a {@link LiteralNode} for `family`.
 */
export const liftOperand = (
	value: unknown,
	family: SqlTypeFamily,
): ExprNode => {
	if (isExpr(value)) {
		return value.exprNode;
	}
	return liftLiteral(value, family);
};

/** Renders a {@link LiteralNode} as injection-safe SQL text. */
export const renderLiteral = (node: LiteralNode): string => {
	const { literal } = node;
	switch (literal.literalKind) {
		case "string":
			return quoteStringLiteral(literal.value);
		case "number":
			return String(literal.value);
		case "boolean":
			if (literal.value) {
				return "true";
			}
			return "false";
		case "null":
			return "null";
		case "timestamp":
			return `${quoteStringLiteral(literal.isoValue)}::timestamptz`;
		default:
			return assertNever(literal);
	}
};
