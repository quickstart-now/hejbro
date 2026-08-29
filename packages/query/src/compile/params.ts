import type {
	BetweenNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	SelectExprNode,
	SelectNode,
	SetOpNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	WindowNode,
	WithEntryNode,
	WithNode,
} from "@hejbro/core";
import { replaceSelectChildExprs, selectChildExprs } from "@hejbro/core";

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
	// harden-query-layer #322 task 2.3: bare placeholders, no cast --
	// Postgres infers the parameter's type from the target column (an
	// insert/update value always has one) and coerces the decimal/array-
	// literal text to it, exactly as it already does for `number`.
	bigint: placeholder,
	array: placeholder,
	// `interval` alone gets an explicit `::interval` cast (mirrors
	// `timestamp`'s own `::timestamptz` precedent): unlike a bigint or
	// array literal's target column, Postgres can't always infer an
	// untyped text parameter as `interval` from context alone (e.g. inside
	// a function call argument or a `returning` expression), so the cast
	// is spelled out rather than left to inference.
	interval: (index) => `${placeholder(index)}::interval`,
	// #425: `json` is bare, like `bigint`/`array` above -- a write value
	// always has a target column, and that column is what decides between
	// `json` and `jsonb`, which no cast written here could know. `bytea`
	// spells its cast out for `interval`'s reason: an untyped text
	// parameter is not coerced to bytea by context alone everywhere a
	// write value can appear.
	json: placeholder,
	bytea: (index) => `${placeholder(index)}::bytea`,
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
	// harden-query-layer #322 task 2.3: `bigint`/`interval`/`array` all
	// carry a plain `text` string (`query/column-value.ts`'s
	// `liftColumnValue`, the sole constructor of these three, always
	// serializes to canonical text first -- see `ast.ts`'s own
	// `LiteralNode` doc for why: the AST stays JSON-serializable,
	// mirroring the existing `timestamp`/`isoValue` precedent). The bind
	// parameter is that text, verbatim -- the driver/Postgres do the
	// actual type coercion, same as every other text-typed parameter here.
	bigint: (literal) => literal.text,
	interval: (literal) => literal.text,
	array: (literal) => literal.text,
	json: (literal) => literal.text,
	bytea: (literal) => literal.text,
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

const liftSelectExprNode = (
	node: SelectExprNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const lifted = liftSelectNode(node.query, startIndex);
	return { node: { ...node, query: lifted.node }, params: lifted.params };
};

/**
 * Lifts a window function's three child positions in render order (#444
 * F1's own discipline, applied to the one clause shape it predates): `fn`'s
 * own args first, then `partitionBy`, then `orderBy` — matching
 * `render-sql.ts`'s `<fn>(…) over (partition by … order by …)` text, so
 * `$n` numbering follows the same left-to-right order a literal appears
 * in. `liftOrderBy` is declared further down this file; referenced here
 * the same way `liftSelectExprNode` above already forward-references
 * `liftSelectNode`.
 */
const liftWindowNode = (
	node: WindowNode,
	startIndex: number,
): Lifted<ExprNode> => {
	const fn = liftFunctionCallNode(node.fn, startIndex);
	const partitionBy = liftExprSequence(
		node.partitionBy,
		startIndex + fn.params.length,
	);
	const orderBy = liftOrderBy(
		node.orderBy,
		startIndex + fn.params.length + partitionBy.params.length,
	);
	return {
		node: {
			...node,
			fn: fn.node as FunctionCallNode,
			partitionBy: partitionBy.node,
			orderBy: orderBy.node,
		},
		params: [...fn.params, ...partitionBy.params, ...orderBy.params],
	};
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
	selectExpr: liftSelectExprNode,
	window: liftWindowNode,
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

/** Lifts a set-operation statement: left branch, then right, then the whole-set orderBy — matching the operator's own render order so `$n` numbering follows the SQL text (add-set-operations). */
export const liftSetOpNode = (
	node: SetOpNode,
	startIndex: number,
): Lifted<SetOpNode> => {
	const left = liftQueryBranch(node.left, startIndex);
	const right = liftQueryBranch(node.right, startIndex + left.params.length);
	const orderBy = liftOrderBy(
		node.orderBy,
		startIndex + left.params.length + right.params.length,
	);
	return {
		node: {
			...node,
			left: left.node,
			right: right.node,
			orderBy: orderBy.node,
		},
		params: [...left.params, ...right.params, ...orderBy.params],
	};
};

const liftQueryBranch = (
	branch: SelectNode | SetOpNode,
	startIndex: number,
): Lifted<SelectNode | SetOpNode> => {
	if (branch.queryKind === "setOp") {
		return liftSetOpNode(branch, startIndex);
	}
	return liftSelectNode(branch, startIndex);
};

/**
 * Lifts a whole {@link SelectNode} by walking {@link selectChildExprs} in
 * its own render order — `distinct on`, projection, joins, `where`,
 * `groupBy`, `having`, `orderBy` (#444 F1: every clause, not the
 * projection/joins/where/orderBy subset this used to hand-list, which
 * left a literal inside `groupBy`/`having`/`distinct on` spliced into
 * the SQL text instead of becoming a bind parameter) — so `$n` numbering
 * matches the order each literal appears in `render-sql.ts`'s rendered
 * SQL. `from`/`limit`/`offset`/`queryKind` are never touched: `from` is
 * a table reference (nothing to lift), and the compiler contract inlines
 * `limit`/`offset` as validated non-negative integers (owner-settled,
 * 2026-08-26). Exported for `liftExistsNode` above and for `select.ts`'s
 * `compileSelect`.
 *
 * **Known consequence of F1, found by the live witness
 * (`packages/pg/test/integration.test.ts`), not a defect in this
 * function**: `distinct on` and the leading `order by` are lifted
 * independently, each literal getting its own `$n`. Postgres's own
 * `DISTINCT ON expressions must match initial ORDER BY expressions`
 * rule compares the parsed expression tree, so the SAME authored
 * literal repeated in both clauses now compiles to two DIFFERENT `$n`
 * placeholders and Postgres rejects the statement — where the old,
 * spec-violating spliced text happened to be byte-identical in both
 * places and so matched. A `columnRef` (the ordinary `distinctOn(t.a)
 * .orderBy(t.a)` shape) is unaffected: nothing about a `columnRef` is
 * ever lifted, so both clauses render the exact same text either way.
 * Deduplicating identical literals into one shared `$n` would fix it
 * and is deliberately not done here — sequential numbering with no
 * deduplication is the owner-settled compiler contract (2026-08-26), so
 * changing that is a separate decision, not a side effect of this fix
 * (tracked in #450, not a 0.2.0 gate).
 */
export const liftSelectNode = (
	node: SelectNode,
	startIndex: number,
): Lifted<SelectNode> => {
	const lifted = selectChildExprs(node).reduce<Lifted<ReadonlyArray<ExprNode>>>(
		(acc, expr) => {
			const result = liftExprNode(expr, startIndex + acc.params.length);
			return {
				node: [...acc.node, result.node],
				params: [...acc.params, ...result.params],
			};
		},
		{ node: [], params: [] },
	);
	return {
		node: replaceSelectChildExprs(node, lifted.node),
		params: lifted.params,
	};
};

/** Lifts one `WITH` entry's own query, threading `$n` numbering forward. */
const liftWithEntry = (
	entry: WithEntryNode,
	startIndex: number,
): Lifted<WithEntryNode> => {
	const lifted = liftQueryBranch(entry.query, startIndex);
	return { node: { ...entry, query: lifted.node }, params: lifted.params };
};

/**
 * Lifts a whole {@link WithNode} (add-ctes, task 5.2): every entry's own
 * query, in declaration order, then the body — matching the rendered
 * text's own left-to-right order (`with "a" as (...), "b" as (...) <body>`)
 * so `$n` numbering follows it. This is the exact defect the proposal
 * rejects "one shared placeholder pool split arbitrarily" (option B) over,
 * proven here rather than assumed: an entry's literal is always bound
 * before the body's, never the reverse, and never inlined as raw text.
 */
export const liftWithNode = (
	node: WithNode,
	startIndex: number,
): Lifted<WithNode> => {
	const ctes = node.ctes.reduce<Lifted<ReadonlyArray<WithEntryNode>>>(
		(acc, entry) => {
			const lifted = liftWithEntry(entry, startIndex + acc.params.length);
			return {
				node: [...acc.node, lifted.node],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);
	const body = liftQueryBranch(node.body, startIndex + ctes.params.length);
	return {
		node: { ...node, ctes: ctes.node, body: body.node },
		params: [...ctes.params, ...body.params],
	};
};
