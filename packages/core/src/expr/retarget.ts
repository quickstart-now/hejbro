import { assertNever } from "../error";
import type {
	BetweenNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	JoinNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	ProjectionNode,
	SelectNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
} from "./ast";

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
	return { schemaName: target.newSchema, tableName: target.newTable };
};

/** Walks every `ExprNode` reachable from `node` (including into an `exists()`'s own `SelectNode`) rewriting `ColumnRefNode`/`TableRefNode` matches for `target`. Returns `node` unchanged (same reference) when nothing matched, so a caller can cheaply check `retargeted !== node` to decide whether re-encoding is needed. */
export const retargetExprNode = (
	node: ExprNode,
	target: RenameTarget,
): ExprNode => {
	switch (node.nodeKind) {
		case "literal":
		case "rawSql":
		case "plpgsqlRef":
			return node;
		case "columnRef": {
			if (
				node.schemaName !== target.oldSchema ||
				node.tableName !== target.oldTable
			) {
				return node;
			}
			const columnName =
				target.oldColumn !== null && node.columnName === target.oldColumn
					? (target.newColumn ?? node.columnName)
					: node.columnName;
			// A table rename always changes schema/table, so this branch is
			// reached meaning something changed -- but a column rename sets
			// oldSchema===newSchema/oldTable===newTable, so a ref on the
			// SAME table but a DIFFERENT column matches the schema/table
			// check above without actually changing. Every value must be
			// compared, not just "did we match the target" -- matching the
			// invariant every other node kind in this file already keeps.
			if (
				node.schemaName === target.newSchema &&
				node.tableName === target.newTable &&
				node.columnName === columnName
			) {
				return node;
			}
			return {
				...node,
				schemaName: target.newSchema,
				tableName: target.newTable,
				columnName,
			};
		}
		case "comparison":
			return retargetComparison(node, target);
		case "logical":
			return retargetLogical(node, target);
		case "not":
			return retargetNot(node, target);
		case "nullTest":
			return retargetNullTest(node, target);
		case "inList":
			return retargetInList(node, target);
		case "between":
			return retargetBetween(node, target);
		case "functionCall":
			return retargetFunctionCall(node, target);
		case "sqlTemplate":
			return retargetSqlTemplate(node, target);
		case "exists":
			return retargetExists(node, target);
		default:
			return assertNever(node);
	}
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

const retargetProjection = (
	projection: ProjectionNode,
	target: RenameTarget,
): ProjectionNode => {
	if (projection.projectionKind !== "columns") {
		return projection;
	}
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

const retargetJoin = (join: JoinNode, target: RenameTarget): JoinNode => {
	const table = retargetTableRef(join.table, target);
	const on = retargetExprNode(join.on, target);
	if (table === join.table && on === join.on) {
		return join;
	}
	return { ...join, table, on };
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

const retargetSelectNode = (
	query: SelectNode,
	target: RenameTarget,
): SelectNode => {
	const projection = retargetProjection(query.projection, target);
	const from = retargetTableRef(query.from, target);
	const joins = query.joins.map((join) => retargetJoin(join, target));
	const where =
		query.where === null ? null : retargetExprNode(query.where, target);
	const orderBy = query.orderBy.map((term) =>
		retargetOrderByTerm(term, target),
	);
	if (
		projection === query.projection &&
		from === query.from &&
		joins.every((join, i) => join === query.joins[i]) &&
		where === query.where &&
		orderBy.every((term, i) => term === query.orderBy[i])
	) {
		return query;
	}
	return { ...query, projection, from, joins, where, orderBy };
};

const retargetExists = (node: ExistsNode, target: RenameTarget): ExprNode => {
	const query = retargetSelectNode(node.query, target);
	if (query === node.query) {
		return node;
	}
	return { ...node, query };
};
