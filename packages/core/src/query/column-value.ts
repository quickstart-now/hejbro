import type { ExprNode } from "../expr/ast";
import { isExpr } from "../expr/ast";
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
export const liftColumnValue = (
	value: unknown,
	typeNode: TypeNode,
): ExprNode => {
	if (isExpr(value)) {
		return value.exprNode;
	}
	if (typeof value === "bigint") {
		// node-postgres's own `prepareValue` already serializes a bind
		// parameter's raw JS `bigint` losslessly, but the AST itself must
		// stay JSON-serializable (`stableJson`/snapshot contract, mirrors
		// the `timestamp`/`isoValue` precedent) -- so the text conversion
		// happens here, once, rather than carrying the raw `bigint` through
		// the AST.
		return {
			nodeKind: "literal",
			literal: { literalKind: "bigint", text: value.toString() },
		};
	}
	const arrayText = resolveArrayLift(typeNode, value);
	if (arrayText !== undefined) {
		return {
			nodeKind: "literal",
			literal: { literalKind: "array", text: arrayText },
		};
	}
	const intervalText = resolveIntervalLift(typeNode, value);
	if (intervalText !== undefined) {
		return {
			nodeKind: "literal",
			literal: { literalKind: "interval", text: intervalText },
		};
	}
	return liftOperand(value, familyOfTypeNode(typeNode));
};
