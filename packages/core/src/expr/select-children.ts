import type {
	DistinctNode,
	ExprNode,
	JoinNode,
	OrderByTerm,
	ProjectionNode,
	SelectNode,
} from "./ast";

/**
 * One `SelectNode` field's child-expression contract: either it carries
 * real expressions (`read` extracts them in this clause's own order,
 * `replace` rebuilds the clause from a same-length replacement list,
 * preserving every non-expression part the clause also carries — a
 * join's `joinKind`/`table`, an order term's `direction`, a projection
 * column's `alias`/`resultKey`), or it carries none (`noExprs`, with a
 * one-line reason a reader can check without re-deriving it).
 */
type ExprClause = {
	readonly clauseKind: "exprClause";
	readonly read: (query: SelectNode) => ReadonlyArray<ExprNode>;
	readonly replace: (
		query: SelectNode,
		exprs: ReadonlyArray<ExprNode>,
	) => SelectNode;
};

type NoExprsClause = {
	readonly clauseKind: "noExprs";
	readonly reason: string;
};

export type ClauseTraversal = ExprClause | NoExprsClause;

const exprClause = (
	read: (query: SelectNode) => ReadonlyArray<ExprNode>,
	replace: (query: SelectNode, exprs: ReadonlyArray<ExprNode>) => SelectNode,
): ExprClause => ({ clauseKind: "exprClause", read, replace });

const noExprs = (reason: string): NoExprsClause => ({
	clauseKind: "noExprs",
	reason,
});

const projectionChildExprs = (
	projection: ProjectionNode,
): ReadonlyArray<ExprNode> => {
	if (projection.projectionKind !== "columns") {
		return [];
	}
	return projection.columns.map((column) => column.expr);
};

/** `true` when every entry of `exprs` is the exact same reference as its `originals` counterpart — the identity-preservation invariant `retarget.ts` depends on (a caller that changed nothing gets the exact same object back, cheaply comparable via `!==`). */
const sameExprs = (
	exprs: ReadonlyArray<ExprNode>,
	originals: ReadonlyArray<ExprNode>,
): boolean => exprs.every((expr, index) => expr === originals[index]);

const replaceProjectionChildExprs = (
	projection: ProjectionNode,
	exprs: ReadonlyArray<ExprNode>,
): ProjectionNode => {
	if (projection.projectionKind !== "columns") {
		return projection;
	}
	if (sameExprs(exprs, projectionChildExprs(projection))) {
		return projection;
	}
	return {
		...projection,
		columns: projection.columns.map((column, index) => ({
			...column,
			expr: exprs[index] as ExprNode,
		})),
	};
};

const distinctChildExprs = (
	distinct: DistinctNode | null,
): ReadonlyArray<ExprNode> => {
	if (distinct === null || distinct.distinctKind !== "on") {
		return [];
	}
	return distinct.columns;
};

const replaceDistinctChildExprs = (
	distinct: DistinctNode | null,
	exprs: ReadonlyArray<ExprNode>,
): DistinctNode | null => {
	if (distinct === null || distinct.distinctKind !== "on") {
		return distinct;
	}
	if (sameExprs(exprs, distinct.columns)) {
		return distinct;
	}
	return { ...distinct, columns: exprs };
};

const joinsChildExprs = (
	joins: ReadonlyArray<JoinNode>,
): ReadonlyArray<ExprNode> => joins.map((join) => join.on);

const replaceJoinsChildExprs = (
	joins: ReadonlyArray<JoinNode>,
	exprs: ReadonlyArray<ExprNode>,
): ReadonlyArray<JoinNode> => {
	if (sameExprs(exprs, joinsChildExprs(joins))) {
		return joins;
	}
	return joins.map((join, index) => ({
		...join,
		on: exprs[index] as ExprNode,
	}));
};

const whereChildExprs = (where: ExprNode | null): ReadonlyArray<ExprNode> => {
	if (where === null) {
		return [];
	}
	return [where];
};

const replaceWhereChildExprs = (
	where: ExprNode | null,
	exprs: ReadonlyArray<ExprNode>,
): ExprNode | null => {
	if (where === null) {
		return where;
	}
	if (exprs[0] === where) {
		return where;
	}
	return exprs[0] as ExprNode;
};

const orderByChildExprs = (
	orderBy: ReadonlyArray<OrderByTerm>,
): ReadonlyArray<ExprNode> => orderBy.map((term) => term.expr);

const replaceOrderByChildExprs = (
	orderBy: ReadonlyArray<OrderByTerm>,
	exprs: ReadonlyArray<ExprNode>,
): ReadonlyArray<OrderByTerm> => {
	if (sameExprs(exprs, orderByChildExprs(orderBy))) {
		return orderBy;
	}
	return orderBy.map((term, index) => ({
		...term,
		expr: exprs[index] as ExprNode,
	}));
};

/**
 * Every field of {@link SelectNode}, mapped to its {@link ClauseTraversal}
 * — a `keyof SelectNode`-keyed object literal, so a field added to
 * `SelectNode` without a matching entry here is a `tsc` "Property ...
 * is missing" error at this one place, the same guarantee a `switch`'s
 * `default: assertNever(node)` gives a discriminated union (window
 * functions, in flight, will be the next field to prove this).
 *
 * **Entry order is render order** — `distinct`, `projection`, `joins`,
 * `where`, `groupBy`, `having`, `orderBy` — not declaration order in
 * {@link SelectNode} itself. This is load-bearing: `@hejbro/query`'s
 * `liftSelectNode` numbers bind parameters by walking {@link
 * selectChildExprs} in order, and that numbering must match the order
 * each literal appears in `render-sql.ts`'s rendered SQL text (`select
 * distinct on (...) <projection> ... group by ... having ... order by
 * ...`) — a JS object literal's own key order is what carries that
 * constraint here; no second ordering list exists anywhere in this file.
 */
const replaceGroupByChildExprs = (
	groupBy: ReadonlyArray<ExprNode>,
	exprs: ReadonlyArray<ExprNode>,
): ReadonlyArray<ExprNode> => {
	if (sameExprs(exprs, groupBy)) {
		return groupBy;
	}
	return exprs;
};

/**
 * Every field's `replace` returns `query` itself, unchanged, when the
 * clause it owns comes back identical (`sameExprs`/each helper's own
 * identity check above) — not just an `Object.is`-equal *rebuild*, the
 * exact same reference. `retarget.ts` depends on this all the way up:
 * an unrelated rename must return the exact same `SelectNode` reference
 * it was given, and that can only hold if every field along the way
 * refuses to allocate a new wrapper for a value that didn't change.
 */
export const SELECT_CLAUSE_TRAVERSALS: {
	readonly [K in keyof SelectNode]: ClauseTraversal;
} = {
	queryKind: noExprs("the statement-kind discriminator, never an expression"),
	distinct: exprClause(
		(query) => distinctChildExprs(query.distinct),
		(query, exprs) => {
			const distinct = replaceDistinctChildExprs(query.distinct, exprs);
			if (distinct === query.distinct) {
				return query;
			}
			return { ...query, distinct };
		},
	),
	projection: exprClause(
		(query) => projectionChildExprs(query.projection),
		(query, exprs) => {
			const projection = replaceProjectionChildExprs(query.projection, exprs);
			if (projection === query.projection) {
				return query;
			}
			return { ...query, projection };
		},
	),
	from: noExprs(
		"a table reference identifier, not an expression — retargetTableRef/render-sql's own table renderer own it",
	),
	joins: exprClause(
		(query) => joinsChildExprs(query.joins),
		(query, exprs) => {
			const joins = replaceJoinsChildExprs(query.joins, exprs);
			if (joins === query.joins) {
				return query;
			}
			return { ...query, joins };
		},
	),
	where: exprClause(
		(query) => whereChildExprs(query.where),
		(query, exprs) => {
			const where = replaceWhereChildExprs(query.where, exprs);
			if (where === query.where) {
				return query;
			}
			return { ...query, where };
		},
	),
	groupBy: exprClause(
		(query) => query.groupBy,
		(query, exprs) => {
			const groupBy = replaceGroupByChildExprs(query.groupBy, exprs);
			if (groupBy === query.groupBy) {
				return query;
			}
			return { ...query, groupBy };
		},
	),
	having: exprClause(
		(query) => whereChildExprs(query.having),
		(query, exprs) => {
			const having = replaceWhereChildExprs(query.having, exprs);
			if (having === query.having) {
				return query;
			}
			return { ...query, having };
		},
	),
	orderBy: exprClause(
		(query) => orderByChildExprs(query.orderBy),
		(query, exprs) => {
			const orderBy = replaceOrderByChildExprs(query.orderBy, exprs);
			if (orderBy === query.orderBy) {
				return query;
			}
			return { ...query, orderBy };
		},
	),
	limit: noExprs("an inlined integer literal, never a bind-able expression"),
	offset: noExprs("an inlined integer literal, never a bind-able expression"),
};

const clauseTraversalEntries = (): ReadonlyArray<ClauseTraversal> =>
	Object.values(SELECT_CLAUSE_TRAVERSALS);

/**
 * Every child expression of `query`, across every clause, in render
 * order (the table's own key order — see {@link SELECT_CLAUSE_TRAVERSALS}'s
 * doc comment). The one traversal `walk.ts`, `render-sql.ts` and
 * `@hejbro/query`'s `liftSelectNode` all consume, so a clause none of
 * them mention (a field added to `SelectNode` with no entry here) fails
 * to compile instead of silently missing at every site.
 */
export const selectChildExprs = (query: SelectNode): ReadonlyArray<ExprNode> =>
	clauseTraversalEntries().flatMap((entry) => {
		if (entry.clauseKind === "noExprs") {
			return [];
		}
		return entry.read(query);
	});

/**
 * The inverse of {@link selectChildExprs}: rebuilds `query` with its
 * child expressions replaced by `exprs`, one-for-one, in the exact same
 * render order `selectChildExprs` produced them in. `exprs` MUST have
 * the same length as `selectChildExprs(query)` — every caller derives it
 * from that call (mapping each expression through a lift/retarget
 * function), never constructs it independently.
 */
export const replaceSelectChildExprs = (
	query: SelectNode,
	exprs: ReadonlyArray<ExprNode>,
): SelectNode =>
	clauseTraversalEntries().reduce(
		(acc, entry) => {
			if (entry.clauseKind === "noExprs") {
				return acc;
			}
			const count = entry.read(acc.node).length;
			const slice = acc.remaining.slice(0, count);
			const remaining = acc.remaining.slice(count);
			return { node: entry.replace(acc.node, slice), remaining };
		},
		{ node: query, remaining: exprs },
	).node;
