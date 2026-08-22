import type { ExprNode } from "./ast";

/**
 * One handler per {@link ExprNode} `nodeKind`, receiving the node narrowed
 * to that exact variant. A mapped type over the full `nodeKind` union
 * (not a hand-written list) so the object literal assigned to it must
 * cover every key: TypeScript reports a missing property at compile time
 * exactly the way a `switch`'s `default: assertNever(node)` reports a
 * missing `case` at compile time — same guarantee, different shape.
 * Verified directly, not assumed: a scratch build with a dummy 14th
 * `nodeKind` added to the `ExprNode` union fails `tsc` at every one of
 * this file's handler maps with "Property ... is missing", the same way
 * it would have failed the old `switch`'s `assertNever` branch.
 */
type SomeExprNodeHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		predicate: (candidate: ExprNode) => boolean,
	) => boolean;
};

/**
 * `exists` is deliberately opaque here (returns `false`, never descends
 * into the subquery) — see {@link someExprNode}'s own doc comment for
 * exactly why that's safe for this function's two real callers and when
 * it stops being safe for a different kind of caller. That property lives
 * in *this* table, not in `someExprNode` itself: the dispatcher below
 * only ever calls whichever handler `node.nodeKind` selects.
 */
const someExprNodeHandlers: SomeExprNodeHandlers = {
	literal: () => false,
	rawSql: () => false,
	exists: () => false,
	plpgsqlRef: () => false,
	columnRef: () => false,
	comparison: (node, predicate) =>
		someExprNode(node.left, predicate) || someExprNode(node.right, predicate),
	logical: (node, predicate) =>
		node.operands.some((operand) => someExprNode(operand, predicate)),
	not: (node, predicate) => someExprNode(node.operand, predicate),
	nullTest: (node, predicate) => someExprNode(node.operand, predicate),
	inList: (node, predicate) =>
		someExprNode(node.operand, predicate) ||
		node.values.some((value) => someExprNode(value, predicate)),
	between: (node, predicate) =>
		someExprNode(node.operand, predicate) ||
		someExprNode(node.lowerBound, predicate) ||
		someExprNode(node.upperBound, predicate),
	functionCall: (node, predicate) =>
		node.args.some((arg) => someExprNode(arg, predicate)),
	sqlTemplate: (node, predicate) =>
		node.chunks.some(
			(chunk) =>
				chunk.chunkKind === "expr" && someExprNode(chunk.expr, predicate),
		),
};

/**
 * Depth-first "some" over an expression tree. Does not descend into
 * `exists` subqueries (they are opaque to the caller's scope) but does
 * visit the `exists` node itself, so callers can reject it.
 *
 * **Why that's safe here, and when it stops being safe.** This function
 * checks `predicate` against a node *before* looking at its children (the
 * `if (predicate(node))` above), so a predicate asking "is this node
 * itself an `exists`" always matches wherever the `exists` sits in the
 * tree — the `exists` handler's own `false` never has to run for that
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
	const handler = someExprNodeHandlers[node.nodeKind] as (
		node: ExprNode,
		predicate: (candidate: ExprNode) => boolean,
	) => boolean;
	return handler(node, predicate);
};
