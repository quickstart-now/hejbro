import type {
	BetweenNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	JoinNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	ProjectionNode,
	SelectNode,
	SqlTemplateChunk,
	SqlTemplateNode,
} from "@hejbro/core";

// This file stays one module on purpose, past the ~300-line guideline:
// `liftExprNode` and `liftSelectNode` below are mutually recursive by
// design (a `where` can nest a correlated `exists (select ...)`, and that
// subquery is itself a whole `SelectNode` to lift) — splitting them into
// two files makes them import each other, which is a real circular
// dependency, not just a stylistic one. Core's `expr/render-sql.ts` (729
// lines) has the exact same `renderExpr` ↔ `renderSelect` recursion over
// the same node vocabulary and made the same call for the same reason;
// this module mirrors it. `select.ts` stays downstream, one-way
// (`compileSelect` only).
//
// A node (or node list) after literal→parameter lifting, plus the bind
// parameters it contributed, in render order. `startIndex` in every
// `lift*` function below is the 1-based `$n` the *next* literal receives;
// callers thread it forward as `startIndex + <params collected so far>`,
// so numbering stays sequential with no deduplication (owner-settled
// compiler contract, 2026-08-26).
export type Lifted<TNode> = {
	readonly node: TNode;
	readonly params: ReadonlyArray<unknown>;
};

const placeholder = (index: number): string => `$${index}`;

// `timestamp` alone gets a `::timestamptz` cast (mirrors `renderLiteral`'s
// inline `'...'::timestamptz`); every other kind is a bare placeholder.
const literalPlaceholderHandlers: {
	readonly [K in LiteralNode["literal"]["literalKind"]]: (
		index: number,
	) => string;
} = {
	string: placeholder,
	number: placeholder,
	boolean: placeholder,
	null: placeholder,
	timestamp: (index) => `${placeholder(index)}::timestamptz`,
};

const literalValueHandlers: {
	readonly [K in LiteralNode["literal"]["literalKind"]]: (
		literal: Extract<LiteralNode["literal"], { readonly literalKind: K }>,
	) => unknown;
} = {
	string: (literal) => literal.value,
	number: (literal) => literal.value,
	boolean: (literal) => literal.value,
	null: () => null,
	timestamp: (literal) => literal.isoValue,
};

/** Lifts one {@link LiteralNode} to a `RawSqlNode{sql:"$n"}` placeholder plus its bind value — never the reverse. */
const liftLiteralNode = (
	node: LiteralNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const sqlHandler = literalPlaceholderHandlers[node.literal.literalKind] as (
		index: number,
	) => string;
	const valueHandler = literalValueHandlers[node.literal.literalKind] as (
		literal: LiteralNode["literal"],
	) => unknown;
	return {
		node: { nodeKind: "rawSql", sql: sqlHandler(startIndex) },
		params: [valueHandler(node.literal)],
	};
};

// `rawSql` must stay verbatim: it is either `sql.raw()` (the one documented
// injection point) or core's internal multi-row-insert `default` marker;
// parameterizing either would corrupt the statement. `columnRef`/
// `plpgsqlRef` simply carry no literal.
const liftUnchangedNode = (node: ExprNode): Lifted<ExprNode> => ({
	node,
	params: [],
});

const liftComparisonNode = (
	node: ComparisonNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const left = liftExprNode(node.left, startIndex);
	const right = liftExprNode(node.right, startIndex + left.params.length);
	return {
		node: { ...node, left: left.node, right: right.node },
		params: [...left.params, ...right.params],
	};
};

/** Lifts an ordered list of expressions, threading `$n` numbering left to right. Exported for `mutation.ts`'s row/set-entry walkers. */
export const liftExprSequence = (
	nodes: ReadonlyArray<ExprNode>,
	startIndex: number,
): Lifted<ReadonlyArray<ExprNode>> =>
	nodes.reduce<Lifted<ReadonlyArray<ExprNode>>>(
		(acc, node) => {
			const lifted = liftExprNode(node, startIndex + acc.params.length);
			return {
				node: [...acc.node, lifted.node],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftLogicalNode = (
	node: LogicalNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const operands = liftExprSequence(node.operands, startIndex);
	return {
		node: { ...node, operands: operands.node },
		params: operands.params,
	};
};

const liftNotNode = (node: NotNode, startIndex: number): Lifted<ExprNode> => {
	const operand = liftExprNode(node.operand, startIndex);
	return { node: { ...node, operand: operand.node }, params: operand.params };
};

const liftNullTestNode = (
	node: NullTestNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const operand = liftExprNode(node.operand, startIndex);
	return { node: { ...node, operand: operand.node }, params: operand.params };
};

const liftInListNode = (
	node: InListNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const operand = liftExprNode(node.operand, startIndex);
	const values = liftExprSequence(
		node.values,
		startIndex + operand.params.length,
	);
	return {
		node: { ...node, operand: operand.node, values: values.node },
		params: [...operand.params, ...values.params],
	};
};

const liftBetweenNode = (
	node: BetweenNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const operand = liftExprNode(node.operand, startIndex);
	const lowerBound = liftExprNode(
		node.lowerBound,
		startIndex + operand.params.length,
	);
	const upperBound = liftExprNode(
		node.upperBound,
		startIndex + operand.params.length + lowerBound.params.length,
	);
	return {
		node: {
			...node,
			operand: operand.node,
			lowerBound: lowerBound.node,
			upperBound: upperBound.node,
		},
		params: [...operand.params, ...lowerBound.params, ...upperBound.params],
	};
};

const liftFunctionCallNode = (
	node: FunctionCallNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const args = liftExprSequence(node.args, startIndex);
	return { node: { ...node, args: args.node }, params: args.params };
};

const liftTextChunk = (
	chunk: Extract<SqlTemplateChunk, { readonly chunkKind: "text" }>,
): Lifted<SqlTemplateChunk> => ({ node: chunk, params: [] });

const liftExprChunk = (
	chunk: Extract<SqlTemplateChunk, { readonly chunkKind: "expr" }>,
	startIndex: number,
): Lifted<SqlTemplateChunk> => {
	const lifted = liftExprNode(chunk.expr, startIndex);
	return {
		node: { chunkKind: "expr", expr: lifted.node },
		params: lifted.params,
	};
};

const chunkLiftHandlers: {
	readonly [K in SqlTemplateChunk["chunkKind"]]: (
		chunk: Extract<SqlTemplateChunk, { readonly chunkKind: K }>,
		startIndex: number,
	) => Lifted<SqlTemplateChunk>;
} = {
	text: liftTextChunk,
	expr: liftExprChunk,
};

const liftTemplateChunks = (
	chunks: ReadonlyArray<SqlTemplateChunk>,
	startIndex: number,
): Lifted<ReadonlyArray<SqlTemplateChunk>> =>
	chunks.reduce<Lifted<ReadonlyArray<SqlTemplateChunk>>>(
		(acc, chunk) => {
			const handler = chunkLiftHandlers[chunk.chunkKind] as (
				chunk: SqlTemplateChunk,
				startIndex: number,
			) => Lifted<SqlTemplateChunk>;
			const lifted = handler(chunk, startIndex + acc.params.length);
			return {
				node: [...acc.node, lifted.node],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftSqlTemplateNode = (
	node: SqlTemplateNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const chunks = liftTemplateChunks(node.chunks, startIndex);
	return { node: { ...node, chunks: chunks.node }, params: chunks.params };
};

const liftExistsNode = (
	node: ExistsNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const lifted = liftSelectNode(node.query, startIndex);
	return { node: { ...node, query: lifted.node }, params: lifted.params };
};

// One handler per `ExprNode["nodeKind"]` — a mapped type over the full
// union, so a missing handler is a `tsc` error (same technique as core's
// `renderExprHandlers`). Every handler is O(1) branch-free, keeping its
// CRAP score low independent of test coverage; only `liftExprNode` itself
// dispatches, and its body is a single lookup-and-call.
const exprLiftHandlers: {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		startIndex: number,
	) => Lifted<ExprNode>;
} = {
	literal: liftLiteralNode,
	columnRef: liftUnchangedNode,
	plpgsqlRef: liftUnchangedNode,
	comparison: liftComparisonNode,
	logical: liftLogicalNode,
	not: liftNotNode,
	nullTest: liftNullTestNode,
	inList: liftInListNode,
	between: liftBetweenNode,
	functionCall: liftFunctionCallNode,
	sqlTemplate: liftSqlTemplateNode,
	rawSql: liftUnchangedNode,
	exists: liftExistsNode,
};

/** Lifts every {@link LiteralNode} inside `node` to a `$n` bind parameter, dispatching by `nodeKind`. */
export const liftExprNode = (
	node: ExprNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const handler = exprLiftHandlers[node.nodeKind] as (
		node: ExprNode,
		startIndex: number,
	) => Lifted<ExprNode>;
	return handler(node, startIndex);
};

const liftProjectionColumns = (
	columns: ReadonlyArray<{ readonly alias: string; readonly expr: ExprNode }>,
	startIndex: number,
): Lifted<ReadonlyArray<{ readonly alias: string; readonly expr: ExprNode }>> =>
	columns.reduce<
		Lifted<ReadonlyArray<{ readonly alias: string; readonly expr: ExprNode }>>
	>(
		(acc, column) => {
			const lifted = liftExprNode(column.expr, startIndex + acc.params.length);
			return {
				node: [...acc.node, { alias: column.alias, expr: lifted.node }],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftColumnsProjection = (
	projection: Extract<ProjectionNode, { readonly projectionKind: "columns" }>,
	startIndex: number,
): Lifted<ProjectionNode> => {
	const lifted = liftProjectionColumns(projection.columns, startIndex);
	return {
		node: { ...projection, columns: lifted.node },
		params: lifted.params,
	};
};

const liftUnchangedProjection = (
	projection: ProjectionNode,
): Lifted<ProjectionNode> => ({ node: projection, params: [] });

// One handler per `ProjectionNode["projectionKind"]` — only an object
// projection has an expression to lift.
const projectionLiftHandlers: {
	readonly [K in ProjectionNode["projectionKind"]]: (
		projection: Extract<ProjectionNode, { readonly projectionKind: K }>,
		startIndex: number,
	) => Lifted<ProjectionNode>;
} = {
	allColumns: liftUnchangedProjection,
	constantOne: liftUnchangedProjection,
	columns: liftColumnsProjection,
};

const liftProjection = (
	projection: ProjectionNode,
	startIndex: number,
): Lifted<ProjectionNode> => {
	const handler = projectionLiftHandlers[projection.projectionKind] as (
		projection: ProjectionNode,
		startIndex: number,
	) => Lifted<ProjectionNode>;
	return handler(projection, startIndex);
};

const liftJoins = (
	joins: ReadonlyArray<JoinNode>,
	startIndex: number,
): Lifted<ReadonlyArray<JoinNode>> =>
	joins.reduce<Lifted<ReadonlyArray<JoinNode>>>(
		(acc, join) => {
			const lifted = liftExprNode(join.on, startIndex + acc.params.length);
			return {
				node: [...acc.node, { ...join, on: lifted.node }],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftWhere = (
	where: ExprNode | null,
	startIndex: number,
): Lifted<ExprNode | null> => {
	if (where === null) {
		return { node: null, params: [] };
	}
	return liftExprNode(where, startIndex);
};

const liftOrderBy = (
	terms: ReadonlyArray<OrderByTerm>,
	startIndex: number,
): Lifted<ReadonlyArray<OrderByTerm>> =>
	terms.reduce<Lifted<ReadonlyArray<OrderByTerm>>>(
		(acc, term) => {
			const lifted = liftExprNode(term.expr, startIndex + acc.params.length);
			return {
				node: [...acc.node, { ...term, expr: lifted.node }],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

/**
 * Lifts a whole {@link SelectNode} in render order — projection, `from`
 * (a table reference only, nothing to lift), joins, `where`, `orderBy` —
 * so `$n` numbering matches the order each literal appears in the
 * rendered SQL. `limit` is never touched: the builder already validated
 * it as a non-negative integer, and the compiler contract inlines it
 * (owner-settled, 2026-08-26). Exported for `liftExistsNode` above and for
 * `select.ts`'s `compileSelect`.
 */
export const liftSelectNode = (
	node: SelectNode,
	startIndex: number,
): Lifted<SelectNode> => {
	const projection = liftProjection(node.projection, startIndex);
	const joins = liftJoins(node.joins, startIndex + projection.params.length);
	const where = liftWhere(
		node.where,
		startIndex + projection.params.length + joins.params.length,
	);
	const orderBy = liftOrderBy(
		node.orderBy,
		startIndex +
			projection.params.length +
			joins.params.length +
			where.params.length,
	);
	return {
		node: {
			...node,
			projection: projection.node,
			joins: joins.node,
			where: where.node,
			orderBy: orderBy.node,
		},
		params: [
			...projection.params,
			...joins.params,
			...where.params,
			...orderBy.params,
		],
	};
};
