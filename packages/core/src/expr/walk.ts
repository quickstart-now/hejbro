import type {
	ColumnRefNode,
	ExistsNode,
	ExprNode,
	SelectExprNode,
	SelectNode,
	TableRefNode,
} from "./ast";

/**
 * The expressions an `exists()` node's own subquery can itself contain:
 * its `where`, every join's `on`, and every `orderBy` term's `expr` —
 * exactly the fields a correlated reference or a nested `exists()` can
 * appear in (the subquery's `projection` is always `constantOne`, D70,
 * so there is no path through the public DSL for a real expression to
 * reach it — see {@link someDeepExprNode}'s own doc comment). Shared by
 * {@link someDeepExprNode}'s `exists` handler and `dsl/rls.ts`'s
 * declaration-time scope walk (#160), so the two walkers can't drift
 * apart on what "descending into `exists`" means.
 */
const whereExprOrEmpty = (where: ExprNode | null): ReadonlyArray<ExprNode> => {
	if (where === null) {
		return [];
	}
	return [where];
};

/** A projection's own expressions — only the `columns` kind carries any. */
const projectionChildExprs = (
	projection: SelectNode["projection"],
): ReadonlyArray<ExprNode> => {
	if (projection.projectionKind !== "columns") {
		return [];
	}
	return projection.columns.map((column) => column.expr);
};

/** Every child expression of an embedded select — unlike {@link existsChildExprs}, the projection is included: a `selectExpr`'s projection is the point, never a rewritten `constantOne`. */
export const selectExprChildExprs = (
	node: SelectExprNode,
): ReadonlyArray<ExprNode> => {
	const { query } = node;
	const projectionExprs = projectionChildExprs(query.projection);
	return [
		...projectionExprs,
		...whereExprOrEmpty(query.where),
		...query.joins.map((join) => join.on),
		...query.orderBy.map((term) => term.expr),
	];
};

export const existsChildExprs = (node: ExistsNode): ReadonlyArray<ExprNode> => {
	const { query } = node;
	return [
		...whereExprOrEmpty(query.where),
		...query.joins.map((join) => join.on),
		...query.orderBy.map((term) => term.expr),
	];
};

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
	selectExpr: () => false,
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
	exists: (node, predicate) =>
		existsChildExprs(node).some((child) => someDeepExprNode(child, predicate)),
	selectExpr: (node, predicate) =>
		selectExprChildExprs(node).some((child) =>
			someDeepExprNode(child, predicate),
		),
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
 * with #160's `findExprScopeViolation` below as a third caller).
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

const isRefInScope = (
	scope: ReadonlyArray<TableRefNode>,
	ref: ColumnRefNode,
): boolean =>
	scope.some(
		(table) =>
			table.schemaName === ref.schemaName && table.tableName === ref.tableName,
	);

/**
 * One handler per {@link ExprNode} `nodeKind` for
 * {@link findExprScopeViolation} — same mapped-type shape as this file's
 * other two handler tables, so a missing handler is a `tsc` error.
 */
type ScopeViolationHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		scope: ReadonlyArray<TableRefNode>,
	) => ColumnRefNode | undefined;
};

const firstScopeViolation = (
	children: ReadonlyArray<ExprNode>,
	scope: ReadonlyArray<TableRefNode>,
): ColumnRefNode | undefined =>
	children
		.map((child) => findExprScopeViolation(child, scope))
		.find((ref): ref is ColumnRefNode => ref !== undefined);

const scopeViolationHandlers: ScopeViolationHandlers = {
	literal: () => undefined,
	rawSql: () => undefined,
	plpgsqlRef: () => undefined,
	columnRef: (node, scope) => {
		if (isRefInScope(scope, node)) {
			return undefined;
		}
		return node;
	},
	comparison: (node, scope) =>
		firstScopeViolation([node.left, node.right], scope),
	logical: (node, scope) => firstScopeViolation(node.operands, scope),
	not: (node, scope) => findExprScopeViolation(node.operand, scope),
	nullTest: (node, scope) => findExprScopeViolation(node.operand, scope),
	inList: (node, scope) =>
		firstScopeViolation([node.operand, ...node.values], scope),
	between: (node, scope) =>
		firstScopeViolation(
			[node.operand, node.lowerBound, node.upperBound],
			scope,
		),
	functionCall: (node, scope) => firstScopeViolation(node.args, scope),
	sqlTemplate: (node, scope) =>
		firstScopeViolation(
			node.chunks
				.filter((chunk) => chunk.chunkKind === "expr")
				.map((chunk) => chunk.expr),
			scope,
		),
	exists: (node, scope) => {
		const extendedScope = [
			node.query.from,
			...node.query.joins.map((join) => join.table),
			...scope,
		];
		return firstScopeViolation(existsChildExprs(node), extendedScope);
	},
	selectExpr: (node, scope) => {
		const extendedScope = [
			node.query.from,
			...node.query.joins.map((join) => join.table),
			...scope,
		];
		return firstScopeViolation(selectExprChildExprs(node), extendedScope);
	},
};

/**
 * The first {@link ColumnRefNode} in `expr` that resolves to a table
 * outside `scope`, or `undefined` when every ref is in scope — depth-first,
 * descending into `exists()` subqueries with `scope` *extended* by that
 * subquery's own `from`/joins (exactly the rule `render-sql.ts`'s
 * `renderSelectClauses` applies when it actually renders one), unlike
 * {@link collectColumnRefs} in `render-sql.ts` (which stops at `exists()`
 * on purpose — a subquery's refs are that caller's own concern, not a
 * flat "every ref in this tree" collection's). A correlated reference to
 * an outer table stays legal at any depth; a reference to any *other*
 * table is a violation, whether it sits at the top level or buried
 * inside `exists()` (#160). Pure and declaration-time-safe: no rendering,
 * no throwing — the caller decides what error (and error *code*) a
 * violation means for its own field (`dsl/rls.ts`'s policy `using`/
 * `withCheck` is the only caller today; CHECK/partial-index `where` don't
 * need this at all, since they reject `exists()` outright at declaration
 * time already — see `dsl/table.ts`'s `validateChecks`/
 * `validateIndexPredicates`).
 */
export const findExprScopeViolation = (
	expr: ExprNode,
	scope: ReadonlyArray<TableRefNode>,
): ColumnRefNode | undefined => {
	const handler = scopeViolationHandlers[expr.nodeKind] as (
		node: ExprNode,
		scope: ReadonlyArray<TableRefNode>,
	) => ColumnRefNode | undefined;
	return handler(expr, scope);
};
