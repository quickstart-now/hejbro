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
 * runtime shape of `value` decides the literal kind. A `typeof`-guarded
 * if-chain, each branch delegating to its own `liftXLiteral` helper above
 * so no single function's own complexity accumulates the whole cascade
 * (D71/#154 ratchet-5) — **not** a lookup-table/handler-map dispatch the
 * way `codec.ts`'s exhaustive `Record`s or this file's own
 * `renderLiteralHandlers` are: `value` is `unknown` here, not already a
 * discriminated union with a tag to index by, and a `Record<typeof-tag,
 * …>` was tried for this function specifically (harden-query-layer #322)
 * and reverted — the branch this function needed only briefly (`bigint`)
 * moved to `query/column-value.ts`'s `liftColumnValue` instead, which
 * left no motivating reason to keep the table shape here.
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
 * unreachable (this union has exactly these eight kinds), so no test could
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
	// harden-query-layer #322: `liftLiteral` (this file's own lifter, the
	// declaration-path function) never constructs `bigint`/`interval`/
	// `array` -- only `query/column-value.ts`'s `liftColumnValue` does, for
	// a mutation write value. These three handlers ARE reachable, though,
	// through nothing more than two public exports: `insert()`/`update()`
	// build the AST via `liftColumnValue`, and `renderQuery()` (this
	// module's own recursive `renderExpr` -> `renderLiteral` descent, not a
	// separate bind-parameter path) renders it inline the same as any other
	// literal -- pinned by `core/test/query/mutate.test.ts`'s own
	// "renders bigint/interval/array mutation values inline" test. Each
	// handler's own rendering is grammar-correct SQL text: `bigint` bare
	// (no quotes), `interval` quoted plus an explicit `::interval` cast
	// (mirrors `timestamp`'s own `::timestamptz` above), `array` quoted with
	// no cast (the target column resolves the parameter's type, mirroring
	// `compile/params.ts`'s own bare bigint/array bind-parameter decision).
	bigint: (literal) => literal.text,
	interval: (literal) => `${quoteStringLiteral(literal.text)}::interval`,
	array: (literal) => quoteStringLiteral(literal.text),
	// #425: json carries WHICH of the two types it was declared as, so a
	// `json` column is never rendered through a `::jsonb` cast (which would
	// apply jsonb's key reordering and duplicate-stripping to a column
	// whose point is that it does not do that). `bytea` renders Postgres
	// hex format, quoted; `standard_conforming_strings` is on by default,
	// so the backslash is literal.
	json: (literal) => `${quoteStringLiteral(literal.text)}::${literal.typeName}`,
	bytea: (literal) => `${quoteStringLiteral(literal.text)}::bytea`,
};

export const renderLiteral = (node: LiteralNode): string => {
	const { literal } = node;
	const handler = renderLiteralHandlers[literal.literalKind] as (
		literal: LiteralNode["literal"],
	) => string;
	return handler(literal);
};
