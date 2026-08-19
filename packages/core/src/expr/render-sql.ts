import { assertNever, throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type {
	ColumnRefNode,
	DeleteNode,
	ExprNode,
	InsertNode,
	OnConflictNode,
	ProjectionNode,
	QueryNode,
	ReturningNode,
	SelectNode,
	SqlTemplateChunk,
	TableRefNode,
	UpdateNode,
} from "./ast";
import { renderLiteral } from "./literal";

/** Composite node kinds that must be parenthesized when used as an operand. */
const compositeNodeKinds = new Set([
	"comparison",
	"logical",
	"not",
	"nullTest",
	"inList",
	"between",
]);

const nullTestKeyword = (negated: boolean): string => {
	if (negated) {
		return "is not null";
	}
	return "is null";
};

const inListKeyword = (negated: boolean): string => {
	if (negated) {
		return "not in";
	}
	return "in";
};

const betweenKeyword = (negated: boolean): string => {
	if (negated) {
		return "not between";
	}
	return "between";
};

const existsKeyword = (negated: boolean): string => {
	if (negated) {
		return "not exists";
	}
	return "exists";
};

const qualifiedFunctionName = (
	schemaName: string | null,
	functionName: string,
): string => {
	if (schemaName === null) {
		return functionName;
	}
	return `${schemaName}.${functionName}`;
};

const renderSqlTemplateChunk = (
	chunk: SqlTemplateChunk,
	outerScope: ReadonlyArray<TableRefNode> | undefined,
): string => {
	switch (chunk.chunkKind) {
		case "text":
			return chunk.text;
		case "expr":
			return renderExpr(chunk.expr, outerScope);
		default:
			return assertNever(chunk);
	}
};

const renderOperand = (
	node: ExprNode,
	outerScope: ReadonlyArray<TableRefNode> | undefined,
): string => {
	const rendered = renderExpr(node, outerScope);
	if (compositeNodeKinds.has(node.nodeKind)) {
		return `(${rendered})`;
	}
	return rendered;
};

/** Renders a table reference schema-qualified: `qualifyName(schema, table)`. */
export const renderTableRef = (node: TableRefNode): string =>
	qualifyName(node.schemaName, node.tableName);

/**
 * Walks an {@link ExprNode} collecting every {@link ColumnRefNode} it
 * mentions — used to validate a query's scope. Does NOT descend into
 * `exists` subqueries: a subquery validates its own scope independently
 * when it is rendered (its `from`/joins extend the scope it inherits).
 */
export const collectColumnRefs = (
	node: ExprNode,
): ReadonlyArray<ColumnRefNode> => {
	switch (node.nodeKind) {
		case "literal":
		case "rawSql":
		case "exists":
			return [];
		case "columnRef":
			return [node];
		case "comparison":
			return [
				...collectColumnRefs(node.left),
				...collectColumnRefs(node.right),
			];
		case "logical":
			return node.operands.flatMap(collectColumnRefs);
		case "not":
			return collectColumnRefs(node.operand);
		case "nullTest":
			return collectColumnRefs(node.operand);
		case "inList":
			return [
				...collectColumnRefs(node.operand),
				...node.values.flatMap(collectColumnRefs),
			];
		case "between":
			return [
				...collectColumnRefs(node.operand),
				...collectColumnRefs(node.lowerBound),
				...collectColumnRefs(node.upperBound),
			];
		case "functionCall":
			return node.args.flatMap(collectColumnRefs);
		case "sqlTemplate":
			return node.chunks.flatMap((chunk) => {
				if (chunk.chunkKind === "expr") {
					return collectColumnRefs(chunk.expr);
				}
				return [];
			});
		default:
			return assertNever(node);
	}
};

const isInScope = (
	scope: ReadonlyArray<TableRefNode>,
	ref: ColumnRefNode,
): boolean =>
	scope.some(
		(table) =>
			table.schemaName === ref.schemaName && table.tableName === ref.tableName,
	);

const findForeignColumnRef = (
	scope: ReadonlyArray<TableRefNode>,
	refs: ReadonlyArray<ColumnRefNode>,
): ColumnRefNode | undefined => refs.find((ref) => !isInScope(scope, ref));

const collectProjectionRefs = (
	projection: ProjectionNode,
): ReadonlyArray<ColumnRefNode> => {
	switch (projection.projectionKind) {
		case "allColumns":
		case "constantOne":
			return [];
		case "columns":
			return projection.columns.flatMap((entry) =>
				collectColumnRefs(entry.expr),
			);
		default:
			return assertNever(projection);
	}
};

const renderProjection = (
	projection: ProjectionNode,
	scope: ReadonlyArray<TableRefNode>,
): string => {
	switch (projection.projectionKind) {
		case "allColumns":
			return projection.columnNames.map(quoteIdentifier).join(", ");
		case "constantOne":
			return "1";
		case "columns":
			return projection.columns
				.map(
					(entry) =>
						`${renderExpr(entry.expr, scope)} as ${quoteIdentifier(entry.alias)}`,
				)
				.join(", ");
		default:
			return assertNever(projection);
	}
};

const renderOnConflictAction = (
	action: OnConflictNode["action"],
	scope: ReadonlyArray<TableRefNode>,
): string => {
	switch (action.actionKind) {
		case "nothing":
			return "do nothing";
		case "update": {
			const setSql = action.set
				.map(
					(entry) =>
						`${quoteIdentifier(entry.columnName)} = ${renderExpr(entry.value, scope)}`,
				)
				.join(", ");
			return `do update set ${setSql}`;
		}
		default:
			return assertNever(action);
	}
};

const renderOnConflict = (
	onConflict: OnConflictNode | null,
	scope: ReadonlyArray<TableRefNode>,
): string => {
	if (onConflict === null) {
		return "";
	}
	const targetSql = onConflict.targetColumns.map(quoteIdentifier).join(", ");
	return `on conflict (${targetSql}) ${renderOnConflictAction(onConflict.action, scope)}`;
};

const renderReturning = (
	returning: ReturningNode | null,
	scope: ReadonlyArray<TableRefNode>,
): string => {
	if (returning === null) {
		return "";
	}
	switch (returning.returningKind) {
		case "allColumns":
			return `returning ${returning.columnNames.map(quoteIdentifier).join(", ")}`;
		case "columns":
			return `returning ${returning.columns
				.map(
					(entry) =>
						`${renderExpr(entry.expr, scope)} as ${quoteIdentifier(entry.alias)}`,
				)
				.join(", ")}`;
		default:
			return assertNever(returning);
	}
};

/**
 * Renders a {@link SelectNode} as deterministic SQL text. `outerScope`
 * names tables inherited from an enclosing query (correlated subqueries —
 * see the module-level scope rule). Every `columnRef` mentioned in the
 * projection/joins/where/orderBy must belong to a table in
 * `[from, …joins, …outerScope]`, or rendering throws `foreign-column-ref`.
 */
export const renderSelect = (
	query: SelectNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const scope = [
		query.from,
		...query.joins.map((join) => join.table),
		...(outerScope ?? []),
	];

	const mentionedRefs = [
		...collectProjectionRefs(query.projection),
		...query.joins.flatMap((join) => collectColumnRefs(join.on)),
		...(query.where === null ? [] : collectColumnRefs(query.where)),
		...query.orderBy.flatMap((term) => collectColumnRefs(term.expr)),
	];
	const badRef = findForeignColumnRef(scope, mentionedRefs);
	if (badRef !== undefined) {
		return throwHejbroError(
			"foreign-column-ref",
			`select from "${query.from.schemaName}.${query.from.tableName}" references column "${badRef.schemaName}.${badRef.tableName}.${badRef.columnName}" — join that table, or reference it from an enclosing query via exists().`,
		);
	}

	const joinsSql = query.joins
		.map(
			(join) =>
				`inner join ${renderTableRef(join.table)} on ${renderExpr(join.on, scope)}`,
		)
		.join(" ");
	const whereSql =
		query.where === null ? "" : `where ${renderExpr(query.where, scope)}`;
	const orderBySql =
		query.orderBy.length === 0
			? ""
			: `order by ${query.orderBy
					.map((term) => `${renderExpr(term.expr, scope)} ${term.direction}`)
					.join(", ")}`;
	const limitSql = query.limit === null ? "" : `limit ${query.limit}`;

	const clauses = [
		`select ${renderProjection(query.projection, scope)}`,
		`from ${renderTableRef(query.from)}`,
		joinsSql,
		whereSql,
		orderBySql,
		limitSql,
	].filter((clause) => clause !== "");

	return clauses.join(" ");
};

/** Renders an {@link InsertNode}. `outerScope` follows the same scope rule as {@link renderSelect} (`[table, …outerScope]`). */
export const renderInsert = (
	node: InsertNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const scope = [node.table, ...(outerScope ?? [])];
	const columnsSql = node.columnNames.map(quoteIdentifier).join(", ");
	const rowsSql = node.rows
		.map(
			(row) => `(${row.map((value) => renderExpr(value, scope)).join(", ")})`,
		)
		.join(", ");

	const clauses = [
		`insert into ${renderTableRef(node.table)} (${columnsSql}) values ${rowsSql}`,
		renderOnConflict(node.onConflict, scope),
		renderReturning(node.returning, scope),
	].filter((clause) => clause !== "");

	return clauses.join(" ");
};

/** Renders an {@link UpdateNode}. `outerScope` follows the same scope rule as {@link renderSelect} (`[table, …outerScope]`). */
export const renderUpdate = (
	node: UpdateNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const scope = [node.table, ...(outerScope ?? [])];
	const setSql = node.set
		.map(
			(entry) =>
				`${quoteIdentifier(entry.columnName)} = ${renderExpr(entry.value, scope)}`,
		)
		.join(", ");

	const clauses = [
		`update ${renderTableRef(node.table)} set ${setSql}`,
		node.where === null ? "" : `where ${renderExpr(node.where, scope)}`,
		renderReturning(node.returning, scope),
	].filter((clause) => clause !== "");

	return clauses.join(" ");
};

/** Renders a {@link DeleteNode}. `outerScope` follows the same scope rule as {@link renderSelect} (`[table, …outerScope]`). */
export const renderDelete = (
	node: DeleteNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const scope = [node.table, ...(outerScope ?? [])];

	const clauses = [
		`delete from ${renderTableRef(node.table)}`,
		node.where === null ? "" : `where ${renderExpr(node.where, scope)}`,
		renderReturning(node.returning, scope),
	].filter((clause) => clause !== "");

	return clauses.join(" ");
};

/** Dispatches a {@link QueryNode} to its renderer by `queryKind`. */
export const renderQuery = (
	node: QueryNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	switch (node.queryKind) {
		case "select":
			return renderSelect(node, outerScope);
		case "insert":
			return renderInsert(node, outerScope);
		case "update":
			return renderUpdate(node, outerScope);
		case "delete":
			return renderDelete(node, outerScope);
		default:
			return assertNever(node);
	}
};

/**
 * Renders an {@link ExprNode} as deterministic SQL text. `outerScope` names
 * the tables an `exists` subquery may correlate against beyond its own
 * `from` — an RLS `using` on `comments` renders with
 * `outerScope = [comments]`, letting a nested
 * `exists (select 1 from posts where posts.id = comments.post_id)` pass
 * scope validation (see {@link renderSelect}).
 */
export const renderExpr = (
	node: ExprNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	switch (node.nodeKind) {
		case "literal":
			return renderLiteral(node);
		case "columnRef":
			return `${qualifyName(node.schemaName, node.tableName)}.${quoteIdentifier(node.columnName)}`;
		case "comparison":
			return `${renderOperand(node.left, outerScope)} ${node.operator} ${renderOperand(node.right, outerScope)}`;
		case "logical": {
			if (node.operands.length === 0) {
				return throwHejbroError(
					"empty-logical-expression",
					"and()/or() need at least one operand — pass at least one boolean expression.",
				);
			}
			return node.operands
				.map((operand) => renderOperand(operand, outerScope))
				.join(` ${node.operator} `);
		}
		case "not":
			return `not ${renderOperand(node.operand, outerScope)}`;
		case "nullTest": {
			const suffix = nullTestKeyword(node.negated);
			return `${renderOperand(node.operand, outerScope)} ${suffix}`;
		}
		case "inList": {
			if (node.values.length === 0) {
				return throwHejbroError(
					"empty-in-list",
					"inArray() received an empty array — an empty in-list is always false in SQL; drop the condition or supply values.",
				);
			}
			const keyword = inListKeyword(node.negated);
			const values = node.values
				.map((value) => renderExpr(value, outerScope))
				.join(", ");
			return `${renderOperand(node.operand, outerScope)} ${keyword} (${values})`;
		}
		case "between": {
			const keyword = betweenKeyword(node.negated);
			return `${renderOperand(node.operand, outerScope)} ${keyword} ${renderOperand(node.lowerBound, outerScope)} and ${renderOperand(node.upperBound, outerScope)}`;
		}
		case "functionCall": {
			const name = qualifiedFunctionName(node.schemaName, node.functionName);
			const args = node.args
				.map((arg) => renderExpr(arg, outerScope))
				.join(", ");
			return `${name}(${args})`;
		}
		case "sqlTemplate":
			return node.chunks
				.map((chunk) => renderSqlTemplateChunk(chunk, outerScope))
				.join("");
		case "rawSql":
			return node.sql;
		case "exists": {
			const keyword = existsKeyword(node.negated);
			return `${keyword} (${renderSelect(node.query, outerScope)})`;
		}
		default:
			return assertNever(node);
	}
};
