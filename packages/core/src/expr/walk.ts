import type {
	ColumnRefNode,
	ExistsNode,
	ExprNode,
	FromNode,
	SelectExprNode,
} from "./ast";
import { exprChildren } from "./expr-children";
import { selectChildExprs } from "./select-children";

/** A CTE reference has no schema (D105) — same narrowing `render-sql.ts`'s own `isCteRef` uses. */
const isCteRef = (
	node: FromNode,
): node is Extract<FromNode, { readonly cteName: string }> => "cteName" in node;

/**
 * Every child expression of an embedded select, `groupBy`/`having`/
 * `distinct on` included (#444) — unlike {@link existsChildExprs}, this
 * also carries the projection: a `selectExpr`'s projection is the point,
 * never a rewritten `constantOne`, so {@link selectChildExprs} (which
 * always includes it) is exactly the right shape here, with nothing to
 * subtract.
 */
export const selectExprChildExprs = (
	node: SelectExprNode,
): ReadonlyArray<ExprNode> => selectChildExprs(node.query);

/**
 * The expressions an `exists()` node's own subquery can itself contain,
 * `groupBy`/`having`/`distinct on` included (#444) — everything {@link
 * selectChildExprs} collects EXCEPT the projection: `buildExists` (D70)
 * always overwrites an `exists()` subquery's projection with the fixed
 * `constantOne` shape before an `ExistsNode` exists at all, so there is
 * no path through the public DSL for a real expression to reach it —
 * that invariant is what lets this function reuse {@link
 * selectExprChildExprs}'s own list wholesale rather than re-deriving
 * "every clause but projection" by hand: `constantOne` contributes zero
 * expressions to {@link selectChildExprs} either way, so including it
 * changes nothing here. Shared by {@link someDeepExprNode}'s `exists`
 * handler and `dsl/rls.ts`'s declaration-time scope walk (#160), so the
 * two walkers can't drift apart on what "descending into `exists`"
 * means.
 */
export const existsChildExprs = (node: ExistsNode): ReadonlyArray<ExprNode> =>
	selectChildExprs(node.query);

/**
 * Depth-first "some" over an expression tree. Does not descend into
 * `exists` subqueries (they are opaque to the caller's scope) but does
 * visit the `exists` node itself, so callers can reject it.
 *
 * **Why that's safe here, and when it stops being safe.** This function
 * checks `predicate` against a node *before* looking at its children (the
 * `if (predicate(node))` above), so a predicate asking "is this node
 * itself an `exists`" always matches wherever the `exists` sits in the
 * tree. That's exactly what this function's only two callers do today:
 * `dsl/table.ts`'s `validateChecks`/`validateIndexPredicates` reject a
 * CHECK or partial-index predicate that *contains* an `exists` node, not
 * one that reaches inside an `exists`'s own subquery.
 *
 * The opacity itself is no longer this function's own case — it falls
 * out of {@link exprChildren} (`expr-children.ts`, #473): `exists`/
 * `selectExpr` report zero direct `ExprNode` children there (their
 * `query` is a `SelectNode`, a different vocabulary), so recursing into
 * `exprChildren(node)` already stops at those two nodes without a special
 * case here.
 *
 * A predicate that needs to find something **inside** an `exists`'s
 * subquery — "does this policy call `auth.uid()` anywhere, including
 * inside an `exists(select(...).where(...))` ownership check" — is a
 * different question this function does not answer, and silently returns
 * a false negative for: `@hejbro/supabase`'s `rls-uncached-auth-call`
 * validator was first written expecting this function's shallow-looking
 * behavior to be sufficient, and missed two of three real cases because
 * of it (#97, #196). A predicate with that shape needs a walker that
 * descends into `exists`, like {@link someDeepExprNode} below or
 * {@link retargetExprNode} (`packages/core/src/expr/retarget.ts`).
 */
export const someExprNode = (
	node: ExprNode,
	predicate: (candidate: ExprNode) => boolean,
): boolean => {
	if (predicate(node)) {
		return true;
	}
	return exprChildren(node).some((child) => someExprNode(child, predicate));
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
 * `exists`/`selectExpr` are this function's only two special cases
 * (#473): {@link exprChildren} reports no direct children for either (a
 * `SelectNode` isn't itself an `ExprNode`), so the generic
 * `exprChildren`-based recursion below is correct for every other kind
 * and only these two need `existsChildExprs`/`selectExprChildExprs`
 * (`selectChildExprs` over their own embedded query) instead. A node
 * kind added later needs no new case here — only a registry entry
 * (`expr-children.ts`) — unless it, too, embeds a `SelectNode` rather
 * than plain `ExprNode` children.
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
	if (node.nodeKind === "exists") {
		return existsChildExprs(node).some((child) =>
			someDeepExprNode(child, predicate),
		);
	}
	if (node.nodeKind === "selectExpr") {
		return selectExprChildExprs(node).some((child) =>
			someDeepExprNode(child, predicate),
		);
	}
	return exprChildren(node).some((child) => someDeepExprNode(child, predicate));
};

const isRefInScope = (
	scope: ReadonlyArray<FromNode>,
	ref: ColumnRefNode,
): boolean =>
	scope.some((source) => {
		if (isCteRef(source)) {
			return ref.schemaName === null && ref.tableName === source.cteName;
		}
		return (
			source.schemaName === ref.schemaName && source.tableName === ref.tableName
		);
	});

/**
 * One handler per {@link ExprNode} `nodeKind` for
 * {@link findExprScopeViolation} — same mapped-type shape as this file's
 * other two handler tables, so a missing handler is a `tsc` error.
 */
type ScopeViolationHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		scope: ReadonlyArray<FromNode>,
	) => ColumnRefNode | undefined;
};

const firstScopeViolation = (
	children: ReadonlyArray<ExprNode>,
	scope: ReadonlyArray<FromNode>,
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
	// `window`'s three positions are plain sibling expressions, not a
	// subquery -- scope is checked in the SAME scope as the surrounding
	// expression, matching `functionCall`'s own args above.
	window: (node, scope) =>
		firstScopeViolation(
			[node.fn, ...node.partitionBy, ...node.orderBy.map((term) => term.expr)],
			scope,
		),
	// A filtered aggregate's condition is a plain sibling expression too
	// (#501/R2), not a subquery -- checked in the SAME scope as the
	// aggregate call itself, same reasoning as `window` above.
	aggregateFilter: (node, scope) =>
		firstScopeViolation([node.fn, node.where], scope),
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
	scope: ReadonlyArray<FromNode>,
): ColumnRefNode | undefined => {
	const handler = scopeViolationHandlers[expr.nodeKind] as (
		node: ExprNode,
		scope: ReadonlyArray<FromNode>,
	) => ColumnRefNode | undefined;
	return handler(expr, scope);
};
