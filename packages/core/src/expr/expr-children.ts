import type {
	BetweenNode,
	ComparisonNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	WindowNode,
} from "./ast";

/**
 * One `ExprNode` kind's own direct-child contract (#473): `read` extracts
 * its `ExprNode` children in render order, `replace` rebuilds the node
 * from a same-length replacement list, preserving every non-`ExprNode`
 * part the node also carries (`comparison.operator`, `inList.negated`,
 * `sqlTemplate`'s text chunks, ...). Mirrors `select-children.ts`'s
 * `ExprClause`/`replace` pattern one level down — this file is the
 * `ExprNode` counterpart of that `SelectNode` one.
 *
 * `exists`/`selectExpr` report **no** direct `ExprNode` children here on
 * purpose: their `query` field is a `SelectNode`, not an `ExprNode`, so it
 * is out of this registry's vocabulary — the same reason
 * `collectColumnRefsHandlers` (`render-sql.ts`) and `someExprNodeHandlers`
 * (`walk.ts`) already treat them as opaque. Descending into that
 * `SelectNode`'s own expressions is `selectChildExprs`'s job
 * (`select-children.ts`, reached via `existsChildExprs`/
 * `selectExprChildExprs`, `walk.ts`) — a different registry, at a
 * different node type, already proven at that level. Folding it into
 * *this* one would conflate "this node's own children" with "expressions
 * reachable by walking into an embedded statement", which is exactly the
 * distinction `someExprNode` (opaque) vs `someDeepExprNode` (descends)
 * exists to keep visible.
 */
type ExprChildTraversal<K extends ExprNode["nodeKind"]> = {
	readonly read: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
	) => ReadonlyArray<ExprNode>;
	readonly replace: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		children: ReadonlyArray<ExprNode>,
	) => Extract<ExprNode, { readonly nodeKind: K }>;
};

const sameByIndex = (
	a: ReadonlyArray<ExprNode>,
	b: ReadonlyArray<ExprNode>,
): boolean =>
	a.length === b.length && a.every((value, index) => value === b[index]);

const noChildren = <
	K extends ExprNode["nodeKind"],
>(): ExprChildTraversal<K> => ({
	read: () => [],
	replace: (node) => node,
});

const comparisonChildren: ExprChildTraversal<"comparison"> = {
	read: (node) => [node.left, node.right],
	replace: (node, children) => {
		const [left, right] = children as [ExprNode, ExprNode];
		if (left === node.left && right === node.right) {
			return node;
		}
		return { ...node, left, right } satisfies ComparisonNode;
	},
};

const logicalChildren: ExprChildTraversal<"logical"> = {
	read: (node) => node.operands,
	replace: (node, children) => {
		if (sameByIndex(children, node.operands)) {
			return node;
		}
		return { ...node, operands: children } satisfies LogicalNode;
	},
};

const notChildren: ExprChildTraversal<"not"> = {
	read: (node) => [node.operand],
	replace: (node, children) => {
		const [operand] = children as [ExprNode];
		if (operand === node.operand) {
			return node;
		}
		return { ...node, operand } satisfies NotNode;
	},
};

const nullTestChildren: ExprChildTraversal<"nullTest"> = {
	read: (node) => [node.operand],
	replace: (node, children) => {
		const [operand] = children as [ExprNode];
		if (operand === node.operand) {
			return node;
		}
		return { ...node, operand } satisfies NullTestNode;
	},
};

const inListChildren: ExprChildTraversal<"inList"> = {
	read: (node) => [node.operand, ...node.values],
	replace: (node, children) => {
		const [operand, ...values] = children as [ExprNode, ...ExprNode[]];
		if (operand === node.operand && sameByIndex(values, node.values)) {
			return node;
		}
		return { ...node, operand, values } satisfies InListNode;
	},
};

const betweenChildren: ExprChildTraversal<"between"> = {
	read: (node) => [node.operand, node.lowerBound, node.upperBound],
	replace: (node, children) => {
		const [operand, lowerBound, upperBound] = children as [
			ExprNode,
			ExprNode,
			ExprNode,
		];
		if (
			operand === node.operand &&
			lowerBound === node.lowerBound &&
			upperBound === node.upperBound
		) {
			return node;
		}
		return { ...node, operand, lowerBound, upperBound } satisfies BetweenNode;
	},
};

const functionCallChildren: ExprChildTraversal<"functionCall"> = {
	read: (node) => node.args,
	replace: (node, children) => {
		if (sameByIndex(children, node.args)) {
			return node;
		}
		return { ...node, args: children } satisfies FunctionCallNode;
	},
};

const sqlTemplateChildren: ExprChildTraversal<"sqlTemplate"> = {
	read: (node) =>
		node.chunks
			.filter(
				(chunk): chunk is Extract<SqlTemplateChunk, { chunkKind: "expr" }> =>
					chunk.chunkKind === "expr",
			)
			.map((chunk) => chunk.expr),
	replace: (node, children) => {
		const rebuilt = node.chunks.reduce<{
			readonly chunks: ReadonlyArray<SqlTemplateChunk>;
			readonly index: number;
		}>(
			(acc, chunk) => {
				if (chunk.chunkKind !== "expr") {
					return { chunks: [...acc.chunks, chunk], index: acc.index };
				}
				const expr = children[acc.index] as ExprNode;
				if (expr === chunk.expr) {
					return { chunks: [...acc.chunks, chunk], index: acc.index + 1 };
				}
				return {
					chunks: [...acc.chunks, { ...chunk, expr }],
					index: acc.index + 1,
				};
			},
			{ chunks: [], index: 0 },
		).chunks;
		if (rebuilt.every((chunk, index) => chunk === node.chunks[index])) {
			return node;
		}
		return { ...node, chunks: rebuilt } satisfies SqlTemplateNode;
	},
};

const windowChildren: ExprChildTraversal<"window"> = {
	// Render order matches walk.ts's own three window tables byte-for-byte
	// (#473's own sharpest evidence): `fn`, then `partitionBy`, then
	// `orderBy`'s own expressions.
	read: (node) => [
		node.fn,
		...node.partitionBy,
		...node.orderBy.map((term) => term.expr),
	],
	replace: (node, children) => {
		const fn = children[0] as FunctionCallNode;
		const partitionBy = children.slice(1, 1 + node.partitionBy.length);
		const orderByExprs = children.slice(1 + node.partitionBy.length);
		if (
			fn === node.fn &&
			sameByIndex(partitionBy, node.partitionBy) &&
			orderByExprs.every((expr, index) => expr === node.orderBy[index]?.expr)
		) {
			return node;
		}
		const orderBy = node.orderBy.map((term, index) => ({
			...term,
			expr: orderByExprs[index] as ExprNode,
		}));
		return { ...node, fn, partitionBy, orderBy } satisfies WindowNode;
	},
};

/**
 * One entry per {@link ExprNode} `nodeKind` — a mapped type over the full
 * union, so a missing entry is a `tsc` error the same way every other
 * exhaustive handler table in this package is (`someExprNodeHandlers`,
 * `collectColumnRefsHandlers`, `retargetExprNodeHandlers`, ...).
 * **Deliberately not exported, and not re-exported from `index.ts`**:
 * this table is `@hejbro/core`'s own internal single source for `ExprNode`
 * child positions, not a public extension point. Exporting it would be
 * the contract change this group (#473) refuses to make — see
 * `packages/query/src/compile/params.ts`'s `liftExprNode` and
 * `packages/supabase/src/validators/rls-uncached-auth-call.ts`'s
 * `ChildrenOfHandlers`, the two traversal tables outside `@hejbro/core`
 * that restate this same shape and stay unfolded for exactly this reason.
 */
const EXPR_CHILD_TRAVERSALS: {
	readonly [K in ExprNode["nodeKind"]]: ExprChildTraversal<K>;
} = {
	literal: noChildren(),
	rawSql: noChildren(),
	plpgsqlRef: noChildren(),
	columnRef: noChildren(),
	comparison: comparisonChildren,
	logical: logicalChildren,
	not: notChildren,
	nullTest: nullTestChildren,
	inList: inListChildren,
	between: betweenChildren,
	functionCall: functionCallChildren,
	sqlTemplate: sqlTemplateChildren,
	exists: noChildren(),
	selectExpr: noChildren(),
	window: windowChildren,
};

/**
 * Every `ExprNode` directly reachable one level below `node`, in render
 * order — the one traversal `walk.ts`'s structural tables,
 * `render-sql.ts`'s `collectColumnRefs`, and `retarget.ts`'s
 * `retargetExprNode` all fold onto (#473).
 */
export const exprChildren = (node: ExprNode): ReadonlyArray<ExprNode> => {
	const traversal = EXPR_CHILD_TRAVERSALS[node.nodeKind] as ExprChildTraversal<
		ExprNode["nodeKind"]
	>;
	return traversal.read(node);
};

/**
 * The inverse of {@link exprChildren}: rebuilds `node` with its direct
 * `ExprNode` children replaced by `children`, one-for-one, in the exact
 * same order {@link exprChildren} produced them in. `children` MUST have
 * the same length as `exprChildren(node)`. Returns `node` itself
 * (same reference) when every replacement child is reference-identical to
 * the original — the invariant `retarget.ts` depends on: an unrelated
 * rename must return the exact same object it was given, all the way up.
 */
export const replaceExprChildren = (
	node: ExprNode,
	children: ReadonlyArray<ExprNode>,
): ExprNode => {
	const traversal = EXPR_CHILD_TRAVERSALS[node.nodeKind] as ExprChildTraversal<
		ExprNode["nodeKind"]
	>;
	return traversal.replace(node, children);
};
