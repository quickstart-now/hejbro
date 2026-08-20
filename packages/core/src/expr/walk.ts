import { assertNever } from "../error";
import type { ExprNode } from "./ast";

/**
 * Depth-first "some" over an expression tree. Does not descend into
 * `exists` subqueries (they are opaque to the caller's scope) but does
 * visit the `exists` node itself, so callers can reject it.
 */
export const someExprNode = (
	node: ExprNode,
	predicate: (candidate: ExprNode) => boolean,
): boolean => {
	if (predicate(node)) {
		return true;
	}
	switch (node.nodeKind) {
		case "literal":
		case "rawSql":
		case "exists":
		case "plpgsqlRef":
		case "columnRef":
			return false;
		case "comparison":
			return (
				someExprNode(node.left, predicate) ||
				someExprNode(node.right, predicate)
			);
		case "logical":
			return node.operands.some((operand) => someExprNode(operand, predicate));
		case "not":
		case "nullTest":
			return someExprNode(node.operand, predicate);
		case "inList":
			return (
				someExprNode(node.operand, predicate) ||
				node.values.some((value) => someExprNode(value, predicate))
			);
		case "between":
			return (
				someExprNode(node.operand, predicate) ||
				someExprNode(node.lowerBound, predicate) ||
				someExprNode(node.upperBound, predicate)
			);
		case "functionCall":
			return node.args.some((arg) => someExprNode(arg, predicate));
		case "sqlTemplate":
			return node.chunks.some(
				(chunk) =>
					chunk.chunkKind === "expr" && someExprNode(chunk.expr, predicate),
			);
		default:
			return assertNever(node);
	}
};
