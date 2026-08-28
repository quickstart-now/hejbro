import type { ExprNode, LiteralNode } from "../expr/ast";
import { isExpr } from "../expr/ast";

/** One {@link LiteralNode}'s payload — the shape every resolver below returns. */
type LiteralValue = LiteralNode["literal"];

import { liftOperand } from "../expr/literal";
import { familyOfTypeNode } from "../expr/type-family";
import { serializeArrayLiteral } from "../types/array-literal-write";
import { serializeInterval } from "../types/interval-serialize";
import type { IntervalValue } from "../types/ts-type-map";
import type { TypeNode } from "../types/type-node";

/**
 * `true` for a plain, non-`Date`, non-array object — the one shape this
 * module's own `interval` lift is allowed to intercept before it would
 * otherwise reach `liftOperand`'s existing `ambiguous-literal` rejection
 * (the array/jsonb ambiguity `liftObjectLiteral` guards, `expr/literal.ts`).
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" &&
	value !== null &&
	!(value instanceof Date) &&
	!Array.isArray(value);

/**
 * The canonical Postgres array literal text for `value` against `typeNode`,
 * or `undefined` when this isn't an array write at all — `typeNode` isn't
 * `"array"`, or `value` isn't actually a JS array (the type gate
 * (`mutate.ts`'s `MutationValue`) already rules this combination out for
 * any legitimately-typed caller, but this function doesn't trust that from
 * the outside). Split out from {@link liftColumnValue} so each guard is its
 * own single branch there (D71/#154 ratchet-5 CRAP discipline) rather than
 * one compound `&&` condition.
 */
const resolveArrayLift = (
	typeNode: TypeNode,
	value: unknown,
): string | undefined => {
	if (typeNode.typeName !== "array") {
		return undefined;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	return serializeArrayLiteral(value, typeNode.element);
};

/**
 * The canonical always-full interval literal text for `value` against
 * `typeNode`, or `undefined` when this isn't an interval write. Same
 * split-for-complexity reasoning as {@link resolveArrayLift}.
 */
const resolveIntervalLift = (
	typeNode: TypeNode,
	value: unknown,
): string | undefined => {
	if (typeNode.typeName !== "interval") {
		return undefined;
	}
	if (!isPlainObject(value)) {
		return undefined;
	}
	return serializeInterval(value as unknown as IntervalValue);
};

/**
 * The serialized JSON text for `value` against `typeNode`, or `undefined`
 * when this isn't a json write. Every JSON-serializable value is admitted,
 * objects and arrays included: the ambiguity `liftLiteral` refuses to
 * guess at (array literal vs jsonb) is not an ambiguity here, because the
 * column's declared type already answered it. Same split-for-complexity
 * reasoning as {@link resolveArrayLift}.
 */
const resolveJsonLift = (
	typeNode: TypeNode,
	value: unknown,
): string | undefined => {
	if (typeNode.typeName !== "json" && typeNode.typeName !== "jsonb") {
		return undefined;
	}
	return JSON.stringify(value);
};

/** Postgres hex format (`\x…`) for a `bytea` write, or `undefined` when this isn't one. A `Uint8Array` is the only accepted shape (`ColumnReadType`'s own bytea mapping) — a string would need an encoding guessed, and a number array would need a range check the type already makes unnecessary. */
const resolveByteaLift = (
	typeNode: TypeNode,
	value: unknown,
): string | undefined => {
	if (typeNode.typeName !== "bytea") {
		return undefined;
	}
	if (!(value instanceof Uint8Array)) {
		return undefined;
	}
	const hex = Array.from(value)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `\\x${hex}`;
};

/**
 * Lifts one mutation write value (`insert()`/`update()`/
 * `onConflictDoUpdate()` — `query/mutate.ts`'s own three call sites, the
 * only importer of this module) to an {@link ExprNode}, given the
 * column's own declared {@link TypeNode}. This is the ONE function in
 * this package that ever constructs a `bigint`/`interval`/`array`
 * {@link LiteralNode} (harden-query-layer #322 task 2.3) — deliberately
 * **not exported from `index.ts`**: a public `liftColumnValue` would let
 * a caller build one of these `ExprNode`s by hand and smuggle it into
 * `.default()`/a comparison operand (wrapped as an `Expr`), at which
 * point "the declaration path can't construct these kinds" (this
 * change's own snapshot-format-safety argument — see
 * `core/test/query/snapshot-reachability.test.ts`) would be a
 * convention this function's own privacy enforces, not a structural
 * fact `tsc` enforces on its own.
 *
 * Delegates every value this doesn't specially handle to
 * {@link liftOperand} (`expr/literal.ts`, unchanged since before #322) —
 * string/number/boolean/`Date`/`null` all still flow through the exact
 * same, pre-existing scalar lifter, and its existing `invalid-literal`/
 * `ambiguous-literal` rejections are untouched.
 */
/** One declared-type-aware lift: the literal for `value` against `typeNode`, or `undefined` when this resolver doesn't own that type. */
type LiteralResolver = (
	typeNode: TypeNode,
	value: unknown,
) => LiteralValue | undefined;

/** A `bigint` is the one lift keyed off the VALUE rather than the declared type — node-postgres serializes a raw JS `bigint` losslessly, but the AST has to stay JSON-serializable (`stableJson`/snapshot contract, mirroring the `timestamp`/`isoValue` precedent), so the text conversion happens here, once. */
const resolveBigintLiteral: LiteralResolver = (_typeNode, value) => {
	if (typeof value !== "bigint") {
		return undefined;
	}
	return { literalKind: "bigint", text: value.toString() };
};

const resolveArrayLiteral: LiteralResolver = (typeNode, value) => {
	const text = resolveArrayLift(typeNode, value);
	if (text === undefined) {
		return undefined;
	}
	return { literalKind: "array", text };
};

const resolveIntervalLiteral: LiteralResolver = (typeNode, value) => {
	const text = resolveIntervalLift(typeNode, value);
	if (text === undefined) {
		return undefined;
	}
	return { literalKind: "interval", text };
};

const resolveByteaLiteral: LiteralResolver = (typeNode, value) => {
	const text = resolveByteaLift(typeNode, value);
	if (text === undefined) {
		return undefined;
	}
	return { literalKind: "bytea", text };
};

const resolveJsonLiteral: LiteralResolver = (typeNode, value) => {
	const text = resolveJsonLift(typeNode, value);
	if (text === undefined) {
		return undefined;
	}
	if (typeNode.typeName === "json") {
		return { literalKind: "json", text, typeName: "json" };
	}
	return { literalKind: "json", text, typeName: "jsonb" };
};

/**
 * The declared-type-aware lifts, in order. A list rather than a chain of
 * guard clauses so adding one is an entry rather than another branch in
 * a function the CRAP gate already watches (#154 ratchet-5) — the same
 * "each guard is its own function" reasoning `resolveArrayLift` above
 * was split out for, carried to its conclusion.
 */
const literalResolvers: ReadonlyArray<LiteralResolver> = [
	resolveBigintLiteral,
	resolveArrayLiteral,
	resolveIntervalLiteral,
	resolveByteaLiteral,
	resolveJsonLiteral,
];

export const liftColumnValue = (
	value: unknown,
	typeNode: TypeNode,
): ExprNode => {
	if (isExpr(value)) {
		return value.exprNode;
	}
	const literal = literalResolvers.reduce<LiteralValue | undefined>(
		(found, resolve) => found ?? resolve(typeNode, value),
		undefined,
	);
	if (literal !== undefined) {
		return { nodeKind: "literal", literal };
	}
	return liftOperand(value, familyOfTypeNode(typeNode));
};
