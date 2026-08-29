import { arrayWithIdentityPreserved } from "../array-identity";
import type {
	BetweenNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FromNode,
	FunctionCallNode,
	InListNode,
	JoinNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	ProjectionNode,
	SelectExprNode,
	SelectNode,
	SetOpNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
	WindowNode,
	WithEntryNode,
	WithNode,
} from "./ast";
import { replaceSelectChildExprs, selectChildExprs } from "./select-children";

/**
 * A table or column rename's old/new identity, for {@link retargetExprNode}
 * to walk an already-decoded expression tree and rewrite every
 * `ColumnRefNode`/`TableRefNode` that names the renamed object (D67 —
 * this is the entire reason expressions are stored structurally instead
 * of as rendered text: without it, a rename leaves stale identifiers
 * behind, silently, inside every default/check/index-where/policy
 * expression that mentioned the old name).
 *
 * A table rename passes `oldColumn: null, newColumn: null` (every column
 * ref on the old table moves to the new table, names unchanged). A
 * column rename passes the same `schema`/`table` on both sides (nothing
 * about the table's identity changes) with the old/new column names set.
 */
export type RenameTarget = {
	readonly oldSchema: string;
	readonly oldTable: string;
	readonly newSchema: string;
	readonly newTable: string;
	readonly oldColumn: string | null;
	readonly newColumn: string | null;
};

const retargetTableRef = (
	ref: TableRefNode,
	target: RenameTarget,
): TableRefNode => {
	if (
		ref.schemaName !== target.oldSchema ||
		ref.tableName !== target.oldTable
	) {
		return ref;
	}
	// A table rename always changes schema/table, so reaching here means
	// something changed -- but a column rename sets
	// oldSchema===newSchema/oldTable===newTable, so a TableRefNode on the
	// SAME table (reached via exists()'s from/join, unaffected by which
	// column was renamed) matches the check above without anything
	// actually changing. Compare the final values, not just "did we
	// match the target" (the same distinction columnRef's own case
	// above already makes -- this function had been missing it).
	if (
		ref.schemaName === target.newSchema &&
		ref.tableName === target.newTable
	) {
		return ref;
	}
	return { schemaName: target.newSchema, tableName: target.newTable };
};

const retargetUnchanged = (node: ExprNode): ExprNode => node;

/**
 * A rename never rewrites a CTE reference (proposal, "A CTE is a
 * from-source"; D105's sentinel-schema rejection carries the same
 * reasoning here): a table rename identifies its target by schema and
 * table together, and a CTE has neither, so it is always left exactly as
 * it is (task 2.2, positive/negative pins proven by tasks 2.3/2.4).
 */
const retargetFromNode = (from: FromNode, target: RenameTarget): FromNode => {
	if ("cteName" in from) {
		return from;
	}
	return retargetTableRef(from, target);
};

const retargetedColumnName = (
	node: Extract<ExprNode, { readonly nodeKind: "columnRef" }>,
	target: RenameTarget,
): string => {
	if (target.oldColumn !== null && node.columnName === target.oldColumn) {
		return target.newColumn ?? node.columnName;
	}
	return node.columnName;
};

/**
 * Does this ref actually name the schema/table `target` renames? Split
 * out of {@link retargetColumnRef} (D71/#154 ratchet-5) so that
 * function's own complexity stays low without folding this question's
 * two comparisons into it.
 */
// A CTE column ref (`schemaName === null`) can never match: `RenameTarget.
// oldSchema` is `string`, never `null` — load-bearing for add-ctes 2.4.
const matchesOldTarget = (
	node: Extract<ExprNode, { readonly nodeKind: "columnRef" }>,
	target: RenameTarget,
): boolean =>
	node.schemaName === target.oldSchema && node.tableName === target.oldTable;

/**
 * Would rewriting this ref for `target` actually change anything, or is
 * it already at the target identity? Split out of {@link
 * retargetColumnRef} the same way as {@link matchesOldTarget}. A table
 * rename always changes schema/table, so reaching this function means
 * something changed -- but a column rename sets
 * oldSchema===newSchema/oldTable===newTable, so a ref on the SAME table
 * but a DIFFERENT column matches {@link matchesOldTarget} without
 * actually changing. Every value must be compared, not just "did we
 * match the target" -- the invariant every other node kind in this file
 * already keeps.
 */
const alreadyAtNewTarget = (
	node: Extract<ExprNode, { readonly nodeKind: "columnRef" }>,
	target: RenameTarget,
	columnName: string,
): boolean =>
	node.schemaName === target.newSchema &&
	node.tableName === target.newTable &&
	node.columnName === columnName;

const retargetColumnRef = (
	node: Extract<ExprNode, { readonly nodeKind: "columnRef" }>,
	target: RenameTarget,
): ExprNode => {
	if (!matchesOldTarget(node, target)) {
		return node;
	}
	const columnName = retargetedColumnName(node, target);
	if (alreadyAtNewTarget(node, target, columnName)) {
		return node;
	}
	return {
		...node,
		schemaName: target.newSchema,
		tableName: target.newTable,
		columnName,
	};
};

const retargetComparison = (
	node: ComparisonNode,
	target: RenameTarget,
): ExprNode => {
	const left = retargetExprNode(node.left, target);
	const right = retargetExprNode(node.right, target);
	if (left === node.left && right === node.right) {
		return node;
	}
	return { ...node, left, right };
};

const retargetLogical = (node: LogicalNode, target: RenameTarget): ExprNode => {
	const operands = node.operands.map((operand) =>
		retargetExprNode(operand, target),
	);
	if (operands.every((operand, i) => operand === node.operands[i])) {
		return node;
	}
	return { ...node, operands };
};

const retargetNot = (node: NotNode, target: RenameTarget): ExprNode => {
	const operand = retargetExprNode(node.operand, target);
	if (operand === node.operand) {
		return node;
	}
	return { ...node, operand };
};

const retargetNullTest = (
	node: NullTestNode,
	target: RenameTarget,
): ExprNode => {
	const operand = retargetExprNode(node.operand, target);
	if (operand === node.operand) {
		return node;
	}
	return { ...node, operand };
};

const retargetInList = (node: InListNode, target: RenameTarget): ExprNode => {
	const operand = retargetExprNode(node.operand, target);
	const values = node.values.map((value) => retargetExprNode(value, target));
	if (
		operand === node.operand &&
		values.every((value, i) => value === node.values[i])
	) {
		return node;
	}
	return { ...node, operand, values };
};

const retargetBetween = (node: BetweenNode, target: RenameTarget): ExprNode => {
	const operand = retargetExprNode(node.operand, target);
	const lowerBound = retargetExprNode(node.lowerBound, target);
	const upperBound = retargetExprNode(node.upperBound, target);
	if (
		operand === node.operand &&
		lowerBound === node.lowerBound &&
		upperBound === node.upperBound
	) {
		return node;
	}
	return { ...node, operand, lowerBound, upperBound };
};

const retargetFunctionCall = (
	node: FunctionCallNode,
	target: RenameTarget,
): ExprNode => {
	const args = node.args.map((arg) => retargetExprNode(arg, target));
	if (args.every((arg, i) => arg === node.args[i])) {
		return node;
	}
	return { ...node, args };
};

const retargetSqlTemplateChunk = (
	chunk: SqlTemplateChunk,
	target: RenameTarget,
): SqlTemplateChunk => {
	if (chunk.chunkKind === "text") {
		return chunk;
	}
	const expr = retargetExprNode(chunk.expr, target);
	if (expr === chunk.expr) {
		return chunk;
	}
	return { ...chunk, expr };
};

const retargetSqlTemplate = (
	node: SqlTemplateNode,
	target: RenameTarget,
): ExprNode => {
	const chunks = node.chunks.map((chunk) =>
		retargetSqlTemplateChunk(chunk, target),
	);
	if (chunks.every((chunk, i) => chunk === node.chunks[i])) {
		return node;
	}
	return { ...node, chunks };
};

/**
 * `from` is the projection's OWN `SelectNode.from` (unretargeted) --
 * needed only for `allColumns`, whose `columnNames` is a denormalized
 * snapshot-only copy of the *same* table's real column names (D27,
 * `view-kind.ts`'s `projectionColumns`; `allColumns` only ever comes from
 * `select(table)`, which always sets `from` to that exact table — never a
 * join). A column rename must rename a matching entry in that list too,
 * or a view's own `ViewSnapshot.columns` (derived from it) goes stale
 * (found while wiring #157's `rewriteExpressionReferences`: the "no
 * leftover diff" test failed with a stale name surviving in `columns`,
 * even though `query`'s own `columnRef`s were correctly retargeted --
 * `allColumns` was never reachable through the four pre-#157 fields, so
 * this branch was untested dead code until a view could reach it). A
 * table rename needs no such rewrite here — column *names* don't change
 * on a table rename, only `query.from`'s table name does (handled by
 * {@link retargetTableRef} at the call site).
 */
const retargetedAllColumnsName = (
	name: string,
	target: RenameTarget,
): string => {
	if (name === target.oldColumn) {
		return target.newColumn ?? name;
	}
	return name;
};

/**
 * `retargetProjection`'s own `"allColumns"` case — `select(table)`'s
 * whole-table projection, retargeted only when `target` actually renames
 * a column of the exact table `from` refers to.
 */
const retargetAllColumnsProjection = (
	projection: Extract<
		ProjectionNode,
		{ readonly projectionKind: "allColumns" }
	>,
	from: TableRefNode,
	target: RenameTarget,
): ProjectionNode => {
	if (
		target.oldColumn === null ||
		from.schemaName !== target.oldSchema ||
		from.tableName !== target.oldTable ||
		!projection.columnNames.includes(target.oldColumn)
	) {
		return projection;
	}
	return {
		...projection,
		columnNames: projection.columnNames.map((name) =>
			retargetedAllColumnsName(name, target),
		),
	};
};

/**
 * `retargetProjection`'s own `"columns"` case — an explicit column list
 * (a view's `defineView` projection), retargeting each entry's own
 * expression independently.
 */
const retargetColumnsProjection = (
	projection: Extract<ProjectionNode, { readonly projectionKind: "columns" }>,
	target: RenameTarget,
): ProjectionNode => {
	const columns = projection.columns.map((entry) => {
		const expr = retargetExprNode(entry.expr, target);
		if (expr === entry.expr) {
			return entry;
		}
		return { ...entry, expr };
	});
	if (columns.every((entry, i) => entry === projection.columns[i])) {
		return projection;
	}
	return { ...projection, columns };
};

const retargetProjection = (
	projection: ProjectionNode,
	from: FromNode,
	target: RenameTarget,
): ProjectionNode => {
	// A CTE's `allColumns` list denormalizes a real table's own column
	// names (D27) -- a CTE has none to denormalize, so a rename can never
	// touch it here (add-ctes task 2.2, same reasoning as retargetFromNode).
	if (projection.projectionKind === "allColumns" && !("cteName" in from)) {
		return retargetAllColumnsProjection(projection, from, target);
	}
	if (projection.projectionKind !== "columns") {
		return projection;
	}
	return retargetColumnsProjection(projection, target);
};

/**
 * A join's `table` identifier only — its `on` expression is retargeted
 * generically by {@link retargetSelectNode}'s own `selectChildExprs`/
 * `replaceSelectChildExprs` pass (#444 F3), same reasoning as {@link
 * retargetProjection}: `table` names an object, not an expression, so it
 * needs its own dedicated rewrite. {@link retargetSetOpNode} has no
 * joins of its own to retarget, so this stays local to `SelectNode`
 * handling, unlike {@link retargetOrderByTerm} below.
 */
const retargetJoinTable = (join: JoinNode, target: RenameTarget): JoinNode => {
	const table = retargetFromNode(join.table, target);
	if (table === join.table) {
		return join;
	}
	return { ...join, table };
};

const retargetOrderByTerm = (
	term: OrderByTerm,
	target: RenameTarget,
): OrderByTerm => {
	const expr = retargetExprNode(term.expr, target);
	if (expr === term.expr) {
		return term;
	}
	return { ...term, expr };
};

/** `true` when every entry of `items` is the exact same reference as its `originals` counterpart — used directly where only the boolean matters (the window-function identifier check below), not the array itself (see `arrayWithIdentityPreserved`, `array-identity.ts`, for that). */
const sameByIndex = <T>(
	items: ReadonlyArray<T>,
	originals: ReadonlyArray<T>,
): boolean => items.every((item, index) => item === originals[index]);

/** `query` itself when none of its three identifier fields changed, else a fresh node carrying the retargeted ones — the base {@link retargetSelectNode} runs its generic expression pass over. */
const selectNodeWithIdentifiers = (
	query: SelectNode,
	projection: ProjectionNode,
	from: FromNode,
	joins: ReadonlyArray<JoinNode>,
): SelectNode => {
	if (
		projection === query.projection &&
		from === query.from &&
		joins === query.joins
	) {
		return query;
	}
	return { ...query, projection, from, joins };
};

/**
 * Retargets a whole {@link SelectNode} for `target`, same identity
 * invariant as {@link retargetExprNode} (returns the exact same reference
 * when nothing matched). Not `exists()`-specific — reused as-is for a
 * view's top-level query (#157), not just one nested inside an
 * `ExistsNode`.
 *
 * `projection` (the `allColumns` case's denormalized `columnNames`) and
 * `from`/each join's `table` carry IDENTIFIERS, not expressions — {@link
 * retargetProjection}, {@link retargetTableRef} and {@link
 * retargetJoinTable} own those directly, the same dedicated handling
 * this function always had (#444 F3 review ruling). Every other clause
 * (`where`/`groupBy`/`having`/`orderBy`/`distinct on`, and each join's
 * own `on`) is expressions only, so {@link selectChildExprs}/{@link
 * replaceSelectChildExprs} cover all of them at once — including
 * `projection`'s own `columns`-case exprs a second time, which is safe
 * precisely because {@link retargetExprNode} is idempotent on an
 * already-retargeted node (proven above, `retargetColumnRef`'s
 * `alreadyAtNewTarget` guard): running it again over exprs `projection`
 * already retargeted finds nothing left to match and hands back the
 * exact same references, so this costs a redundant walk, never a wrong
 * answer or a second rewrite.
 *
 * No separate "did anything change" comparison is needed at the end
 * (unlike the pre-#444 version, D71/#154 ratchet-5's own complexity-
 * splitting reasoning): `base` below is `query` itself, verbatim, when
 * the identifier pass changed nothing, and {@link
 * replaceSelectChildExprs}'s own per-clause identity checks
 * (`select-children.ts`) already hand back `base` unchanged when the
 * expression pass changes nothing either — so an unrelated rename
 * returns `query`'s own reference for free, by construction.
 */
export const retargetSelectNode = (
	query: SelectNode,
	target: RenameTarget,
): SelectNode => {
	const projection = retargetProjection(query.projection, query.from, target);
	const from = retargetFromNode(query.from, target);
	const retargetedJoins = query.joins.map((join) =>
		retargetJoinTable(join, target),
	);
	const joins = arrayWithIdentityPreserved(retargetedJoins, query.joins);
	const base = selectNodeWithIdentifiers(query, projection, from, joins);
	const retargetedExprs = selectChildExprs(base).map((expr) =>
		retargetExprNode(expr, target),
	);
	return replaceSelectChildExprs(base, retargetedExprs);
};

/** Retargets a set-operation statement's branches (add-set-operations) — the same identity invariant: the exact same reference comes back when neither branch changed. */
export const retargetSetOpNode = (
	node: SetOpNode,
	target: RenameTarget,
): SetOpNode => {
	const left = retargetQueryBranch(node.left, target);
	const right = retargetQueryBranch(node.right, target);
	const orderBy = node.orderBy.map((term) => retargetOrderByTerm(term, target));
	const orderByUnchanged = orderBy.every(
		(term, index) => term === node.orderBy[index],
	);
	if (left === node.left && right === node.right && orderByUnchanged) {
		return node;
	}
	return { ...node, left, right, orderBy };
};

const retargetQueryBranch = (
	branch: SelectNode | SetOpNode,
	target: RenameTarget,
): SelectNode | SetOpNode => {
	if (branch.queryKind === "setOp") {
		return retargetSetOpNode(branch, target);
	}
	return retargetSelectNode(branch, target);
};

/** One `WITH` entry's own query, reusing {@link retargetQueryBranch} (a `WithEntryNode.query` is always `SelectNode | SetOpNode`, never another `with`). */
const retargetWithEntry = (
	entry: WithEntryNode,
	target: RenameTarget,
): WithEntryNode => {
	const query = retargetQueryBranch(entry.query, target);
	if (query === entry.query) {
		return entry;
	}
	return { ...entry, query };
};

/**
 * Retargets a whole {@link WithNode} (add-ctes, task 2.2's positive
 * descent arm) — every entry's own query and the body, same identity
 * invariant as {@link retargetExprNode}. Called from production code since
 * task 4.3 (`engine/rename/retarget.ts`'s own `retargetViewQuery`, a
 * stored view's rename path). Unlike {@link retargetSelectNode}'s
 * siblings, no registry forces this handler to exist, and none ever will:
 * this file has no `queryKind`-keyed registry (`render-sql.ts`'s
 * `RenderQueryHandlers` has no counterpart here), and `REACHABLE_NODE_KINDS`
 * is an `ExprNode` vocabulary — `QueryNode.queryKind` was never a member of
 * it and task 4.5 confirmed that stays true (a `WithNode` reaching a
 * stored view adds a producer for kinds already listed, never a new map
 * entry). Task 2.3's dedicated test is therefore the permanent, only
 * defence here — a real caller now depends on this function returning
 * something other than `node`, but that dependency is not wired into any
 * completeness check that would fail loudly if the descent broke.
 */
export const retargetWithNode = (
	node: WithNode,
	target: RenameTarget,
): WithNode => {
	const retargetedCtes = node.ctes.map((entry) =>
		retargetWithEntry(entry, target),
	);
	const ctes = arrayWithIdentityPreserved(retargetedCtes, node.ctes);
	const body = retargetQueryBranch(node.body, target);
	if (ctes === node.ctes && body === node.body) {
		return node;
	}
	return { ...node, ctes, body };
};

const retargetExists = (node: ExistsNode, target: RenameTarget): ExprNode => {
	const query = retargetSelectNode(node.query, target);
	if (query === node.query) {
		return node;
	}
	return { ...node, query };
};

/**
 * `window`'s three child positions are plain sibling expressions, not a
 * subquery — `fn` reuses {@link retargetFunctionCall} directly (its own
 * `nodeKind` is already narrowed to `functionCall`, so the concrete result
 * is always a `FunctionCallNode` even though the function's own return
 * type is the shared `ExprNode`), `partitionBy`/`orderBy` walk generically
 * like every other composite node above.
 */
const retargetWindow = (node: WindowNode, target: RenameTarget): ExprNode => {
	const fn = retargetFunctionCall(node.fn, target) as FunctionCallNode;
	const partitionBy = node.partitionBy.map((expr) =>
		retargetExprNode(expr, target),
	);
	const orderBy = node.orderBy.map((term) => retargetOrderByTerm(term, target));
	if (
		fn === node.fn &&
		sameByIndex(partitionBy, node.partitionBy) &&
		sameByIndex(orderBy, node.orderBy)
	) {
		return node;
	}
	return { ...node, fn, partitionBy, orderBy };
};

const retargetSelectExpr = (
	node: SelectExprNode,
	target: RenameTarget,
): ExprNode => {
	const query = retargetSelectNode(node.query, target);
	if (query === node.query) {
		return node;
	}
	return { ...node, query };
};

/**
 * One handler per {@link ExprNode} `nodeKind` for {@link retargetExprNode}
 * — a mapped type over the full `nodeKind` union, not a hand-written list,
 * so a missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(node)` would have been (verified directly with a
 * scratch dummy-variant edit, #154 PR2). Placed at the end of the file,
 * after every handler it references: unlike a function body (which only
 * runs when called), this object literal is evaluated at module load, so
 * every value it names must already be an initialized const by then.
 */
type RetargetExprNodeHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		target: RenameTarget,
	) => ExprNode;
};

const retargetExprNodeHandlers: RetargetExprNodeHandlers = {
	literal: retargetUnchanged,
	rawSql: retargetUnchanged,
	plpgsqlRef: retargetUnchanged,
	columnRef: retargetColumnRef,
	comparison: retargetComparison,
	logical: retargetLogical,
	not: retargetNot,
	nullTest: retargetNullTest,
	inList: retargetInList,
	between: retargetBetween,
	functionCall: retargetFunctionCall,
	sqlTemplate: retargetSqlTemplate,
	exists: retargetExists,
	selectExpr: retargetSelectExpr,
	window: retargetWindow,
};

/** Walks every `ExprNode` reachable from `node` (including into an `exists()`'s own `SelectNode`) rewriting `ColumnRefNode`/`TableRefNode` matches for `target`. Returns `node` unchanged (same reference) when nothing matched, so a caller can cheaply check `retargeted !== node` to decide whether re-encoding is needed. */
export const retargetExprNode = (
	node: ExprNode,
	target: RenameTarget,
): ExprNode => {
	const handler = retargetExprNodeHandlers[node.nodeKind] as (
		node: ExprNode,
		target: RenameTarget,
	) => ExprNode;
	return handler(node, target);
};
