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

/**
 * Same shape as {@link someExprNodeHandlers}, but every recursive call
 * goes through {@link someDeepExprNode} instead of {@link someExprNode} --
 * a genuine second table, not `someExprNodeHandlers` with one key
 * overridden: each handler function's *body* names which recursive
 * function it calls, so spreading the shallow table in would still
 * recurse shallow everywhere except the top-level `exists` node itself
 * (an `exists` three levels deep inside `and(...)` would never reach the
 * override). Only `exists` differs in behavior -- it descends into the
 * subquery's own child expressions instead of returning `false`.
 */
const someDeepExprNodeHandlers: SomeExprNodeHandlers = {
	literal: () => false,
	rawSql: () => false,
	plpgsqlRef: () => false,
	columnRef: () => false,
	comparison: (node, predicate) =>
		someDeepExprNode(node.left, predicate) ||
		someDeepExprNode(node.right, predicate),
	logical: (node, predicate) =>
		node.operands.some((operand) => someDeepExprNode(operand, predicate)),
	not: (node, predicate) => someDeepExprNode(node.operand, predicate),
	nullTest: (node, predicate) => someDeepExprNode(node.operand, predicate),
	inList: (node, predicate) =>
		someDeepExprNode(node.operand, predicate) ||
		node.values.some((value) => someDeepExprNode(value, predicate)),
	between: (node, predicate) =>
		someDeepExprNode(node.operand, predicate) ||
		someDeepExprNode(node.lowerBound, predicate) ||
		someDeepExprNode(node.upperBound, predicate),
	functionCall: (node, predicate) =>
		node.args.some((arg) => someDeepExprNode(arg, predicate)),
	sqlTemplate: (node, predicate) =>
		node.chunks.some(
			(chunk) =>
				chunk.chunkKind === "expr" && someDeepExprNode(chunk.expr, predicate),
		),
	exists: (node, predicate) => {
		const { query } = node;
		const whereMatch =
			query.where !== null && someDeepExprNode(query.where, predicate);
		const joinMatch = query.joins.some((join) =>
			someDeepExprNode(join.on, predicate),
		);
		const orderByMatch = query.orderBy.some((term) =>
			someDeepExprNode(term.expr, predicate),
		);
		return whereMatch || joinMatch || orderByMatch;
	},
};

/**
 * {@link someExprNode}'s deep counterpart (#141): descends into `exists`
 * subqueries instead of treating them as opaque, so a predicate can find
 * a node buried inside `exists(select(...).where(...))` — a real,
 * common shape (`@hejbro/supabase`'s RLS-helper validators both walk
 * ownership checks written exactly this way). `someExprNode`'s own doc
 * comment names this exact gap and, until now, pointed callers at
 * `retargetExprNode` or a validator's own hand-rolled local walker
 * (`packages/supabase/src/validators/rls-uncached-auth-call.ts`'s
 * `childrenOf`) as the only options — this consolidates that shape into
 * one exported function instead of a second and third copy of it (#141,
 * with #160's future `assertExprScope` as a third planned caller).
 *
 * `exists()`'s subquery `projection` is deliberately not walked: D70's
 * `buildExists` always overwrites it with the fixed `constantOne` shape
 * before an `ExistsNode` exists at all, so there is no path through the
 * public DSL for a real expression to reach it.
 */
export const someDeepExprNode = (
	node: ExprNode,
	predicate: (candidate: ExprNode) => boolean,
): boolean => {
	if (predicate(node)) {
		return true;
	}
	const handler = someDeepExprNodeHandlers[node.nodeKind] as (
		node: ExprNode,
		predicate: (candidate: ExprNode) => boolean,
	) => boolean;
	return handler(node, predicate);
};
