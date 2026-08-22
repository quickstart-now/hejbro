import { throwHejbroError } from "../error";
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
		`got a plain ${kind} — hejbro cannot infer whether this is a Postgres array or jsonb. Next: wrap it explicitly (e.g. sql\`…\`) or pass a scalar.`,
	);
};

const liftStringLiteral = (value: string): LiteralNode => ({
	nodeKind: "literal",
	literal: { literalKind: "string", value },
});

const liftNumberLiteral = (value: number): LiteralNode => {
	if (!Number.isFinite(value)) {
		return throwHejbroError(
			"invalid-literal",
			`${value} is not a finite number — SQL numeric literals must be finite. Next: compute the value before declaring it (check for a division by zero or an unresolved Infinity/NaN somewhere upstream).`,
		);
	}
	return { nodeKind: "literal", literal: { literalKind: "number", value } };
};

const liftBooleanLiteral = (value: boolean): LiteralNode => ({
	nodeKind: "literal",
	literal: { literalKind: "boolean", value },
});

const liftDateLiteral = (value: Date): LiteralNode => {
	if (Number.isNaN(value.getTime())) {
		return throwHejbroError(
			"invalid-literal",
			`invalid Date — SQL timestamp literals need a valid date. Next: pass a valid Date (e.g. new Date() or a value from a successful Date.parse()) — this usually comes from new Date(NaN) or parsing an unparseable date string.`,
		);
	}
	return {
		nodeKind: "literal",
		literal: { literalKind: "timestamp", isoValue: value.toISOString() },
	};
};

/**
 * `typeof value === "object"`'s three real cases: `null` itself (`typeof
 * null === "object"` in JS, so this is where the original cascade's
 * separate `value === null` check ends up once reordered), a `Date`, or
 * anything else (rejected -- ambiguous array/jsonb, see
 * {@link rejectAmbiguousLiteral}).
 */
const liftObjectLiteral = (value: object | null): LiteralNode => {
	if (value === null) {
		return { nodeKind: "literal", literal: { literalKind: "null" } };
	}
	if (value instanceof Date) {
		return liftDateLiteral(value);
	}
	return rejectAmbiguousLiteral(value);
};

const liftUnsupportedLiteral = (value: unknown): never =>
	throwHejbroError(
		"invalid-literal",
		`got a ${typeof value} — hejbro cannot lift this into a SQL literal. Next: pass a string, number, boolean, null, or Date.`,
	);

/**
 * Validates and narrows a JS value into a {@link LiteralNode} renderable as
 * SQL. `family` is currently only used by callers to describe intent — the
 * runtime shape of `value` decides the literal kind. Dispatches on
 * `typeof value` to one of the `liftXLiteral` helpers above, each split
 * out to keep its own complexity under threshold (D71/#154 ratchet-5)
 * rather than one function whose own complexity the whole cascade
 * dominates -- same shape as `codec.ts`'s handler maps, but dispatching on
 * `typeof` instead of a discriminated union's own tag, since `value` here
 * is `unknown`, not already one.
 */
export const liftLiteral = (
	value: unknown,
	_family: SqlTypeFamily,
): LiteralNode => {
	if (typeof value === "string") {
		return liftStringLiteral(value);
	}
	if (typeof value === "number") {
		return liftNumberLiteral(value);
	}
	if (typeof value === "boolean") {
		return liftBooleanLiteral(value);
	}
	if (typeof value === "object") {
		return liftObjectLiteral(value);
	}
	return liftUnsupportedLiteral(value);
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

/**
 * Renders a {@link LiteralNode} as injection-safe SQL text. One handler
 * per `literal.literalKind`, same
 * technique as `codec.ts`'s `encodeLiteralHandlers` (#154 ratchet-5): the
 * former `switch`'s `default: assertNever(literal)` was structurally
 * unreachable (this union has exactly these five kinds), so no test could
 * ever reach it.
 */
type RenderLiteralHandlers = {
	readonly [K in LiteralNode["literal"]["literalKind"]]: (
		literal: Extract<LiteralNode["literal"], { readonly literalKind: K }>,
	) => string;
};

const renderBooleanLiteral = (
	literal: Extract<LiteralNode["literal"], { readonly literalKind: "boolean" }>,
): string => {
	if (literal.value) {
		return "true";
	}
	return "false";
};

const renderLiteralHandlers: RenderLiteralHandlers = {
	string: (literal) => quoteStringLiteral(literal.value),
	number: (literal) => String(literal.value),
	boolean: renderBooleanLiteral,
	null: () => "null",
	timestamp: (literal) =>
		`${quoteStringLiteral(literal.isoValue)}::timestamptz`,
};

export const renderLiteral = (node: LiteralNode): string => {
	const { literal } = node;
	const handler = renderLiteralHandlers[literal.literalKind] as (
		literal: LiteralNode["literal"],
	) => string;
	return handler(literal);
};
