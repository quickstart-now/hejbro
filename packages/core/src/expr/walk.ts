import { assertNever } from "../error";
import type { ExprNode } from "./ast";

/**
 * Depth-first "some" over an expression tree. Does not descend into
 * `exists` subqueries (they are opaque to the caller's scope) but does
 * visit the `exists` node itself, so callers can reject it.
 *
 * **Why that's safe here, and when it stops being safe.** This function
 * checks `predicate` against a node *before* looking at its children (the
 * `if (predicate(node))` above), so a predicate asking "is this node
 * itself an `exists`" always matches wherever the `exists` sits in the
 * tree — the `exists` case's own `return false` never has to run for that
 * kind of predicate. That's exactly what this function's only two callers
 * do today: `dsl/table.ts`'s `validateChecks`/`validateIndexPredicates`
 * reject a CHECK or partial-index predicate that *contains* an `exists`
 * node, not one that reaches inside an `exists`'s own subquery.
 *
 * A predicate that needs to find something **inside** an `exists`'s
 * subquery — "does this policy call `auth.uid()` anywhere, including
 * inside an `exists(select(...).where(...))` ownership check" — is a
 * different question this function does not answer, and silently returns
 * a false negative for: `@hejbro/supabase`'s `rls-uncached-auth-call`
 * validator was first written expecting this function's shallow-looking
 * behavior to be sufficient, and missed two of three real cases because
 * of it (#97, #196). A predicate with that shape needs a walker that
 * descends into `exists`, like {@link retargetExprNode}
 * (`packages/core/src/expr/retarget.ts`) or that validator's own local
 * tree walker (`packages/supabase/src/validators/rls-uncached-auth-call.ts`).
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
