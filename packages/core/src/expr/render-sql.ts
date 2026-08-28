import { assertNever, throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type {
	BetweenNode,
	ColumnRefNode,
	ComparisonNode,
	DeleteNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	InsertNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OnConflictNode,
	OrderByTerm,
	PlpgsqlRefNode,
	ProjectionNode,
	QueryNode,
	RawSqlNode,
	ReturningNode,
	SelectExprNode,
	SelectNode,
	SetOpNode,
	SqlTemplateChunk,
	SqlTemplateNode,
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
 * One handler per {@link ExprNode} `nodeKind` for {@link collectColumnRefs}
 * — a mapped type over the full `nodeKind` union, not a hand-written list,
 * so a missing handler is a `tsc` error ("Property ... is missing") the
 * same way a `switch`'s `default: assertNever(node)` would have been
 * (verified directly with a scratch dummy-variant edit, #154 PR2).
 */
type CollectColumnRefsHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
	) => ReadonlyArray<ColumnRefNode>;
};

/**
 * `exists` returns `[]` here deliberately: a subquery validates its own
 * scope independently when it is rendered (its `from`/joins extend the
 * scope it inherits), so its column refs are never this walk's concern.
 */
const collectColumnRefsHandlers: CollectColumnRefsHandlers = {
	literal: () => [],
	rawSql: () => [],
	exists: () => [],
	selectExpr: () => [],
	plpgsqlRef: () => [],
	columnRef: (node) => [node],
	comparison: (node) => [
		...collectColumnRefs(node.left),
		...collectColumnRefs(node.right),
	],
	logical: (node) => node.operands.flatMap(collectColumnRefs),
	not: (node) => collectColumnRefs(node.operand),
	nullTest: (node) => collectColumnRefs(node.operand),
	inList: (node) => [
		...collectColumnRefs(node.operand),
		...node.values.flatMap(collectColumnRefs),
	],
	between: (node) => [
		...collectColumnRefs(node.operand),
		...collectColumnRefs(node.lowerBound),
		...collectColumnRefs(node.upperBound),
	],
	functionCall: (node) => node.args.flatMap(collectColumnRefs),
	sqlTemplate: (node) =>
		node.chunks.flatMap((chunk) => {
			if (chunk.chunkKind === "expr") {
				return collectColumnRefs(chunk.expr);
			}
			return [];
		}),
};

/**
 * Walks an {@link ExprNode} collecting every {@link ColumnRefNode} it
 * mentions — used to validate a query's scope. Does NOT descend into
 * `exists` subqueries: a subquery validates its own scope independently
 * when it is rendered (its `from`/joins extend the scope it inherits).
 */
export const collectColumnRefs = (
	node: ExprNode,
): ReadonlyArray<ColumnRefNode> => {
	const handler = collectColumnRefsHandlers[node.nodeKind] as (
		node: ExprNode,
	) => ReadonlyArray<ColumnRefNode>;
	return handler(node);
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

/**
 * Throws `foreign-column-ref` if any of `refs` falls outside `scope` —
 * shared by every query renderer (`select`, `insert`, `update`, `delete`)
 * so a mutation's `where`/`set`/`values`/`returning` expressions are
 * validated exactly like a select's (Phase 3 function bodies rely on this
 * for all four statement kinds, not just `select`).
 */
const assertInScope = (
	scope: ReadonlyArray<TableRefNode>,
	refs: ReadonlyArray<ColumnRefNode>,
	verb: string,
	subject: TableRefNode,
): void => {
	const badRef = findForeignColumnRef(scope, refs);
	if (badRef !== undefined) {
		throwHejbroError(
			"foreign-column-ref",
			`${verb} "${subject.schemaName}.${subject.tableName}" references column "${badRef.schemaName}.${badRef.tableName}.${badRef.columnName}". Next: join that table, or reference it from an enclosing query via exists().`,
		);
	}
};

const collectReturningRefs = (
	returning: ReturningNode | null,
): ReadonlyArray<ColumnRefNode> => {
	if (returning === null) {
		return [];
	}
	switch (returning.returningKind) {
		case "allColumns":
			return [];
		case "columns":
			return returning.columns.flatMap((entry) =>
				collectColumnRefs(entry.expr),
			);
		default:
			return assertNever(returning);
	}
};

const collectOnConflictRefs = (
	onConflict: OnConflictNode | null,
): ReadonlyArray<ColumnRefNode> => {
	if (onConflict === null) {
		return [];
	}
	switch (onConflict.action.actionKind) {
		case "nothing":
			return [];
		case "update":
			return onConflict.action.set.flatMap((entry) =>
				collectColumnRefs(entry.value),
			);
		default:
			return assertNever(onConflict.action);
	}
};

const collectSetRefs = (set: UpdateNode["set"]): ReadonlyArray<ColumnRefNode> =>
	set.flatMap((entry) => collectColumnRefs(entry.value));

const collectRowsRefs = (
	rows: ReadonlyArray<ReadonlyArray<ExprNode>>,
): ReadonlyArray<ColumnRefNode> =>
	rows.flatMap((row) => row.flatMap(collectColumnRefs));

const collectWhereRefs = (
	where: ExprNode | null,
): ReadonlyArray<ColumnRefNode> => {
	if (where === null) {
		return [];
	}
	return collectColumnRefs(where);
};

const whereClause = (
	where: ExprNode | null,
	scope: ReadonlyArray<TableRefNode>,
): string => {
	if (where === null) {
		return "";
	}
	return `where ${renderExpr(where, scope)}`;
};

const orderByClause = (
	orderBy: ReadonlyArray<OrderByTerm>,
	scope: ReadonlyArray<TableRefNode>,
): string => {
	if (orderBy.length === 0) {
		return "";
	}
	const terms = orderBy
		.map((term) => `${renderExpr(term.expr, scope)} ${term.direction}`)
		.join(", ");
	return `order by ${terms}`;
};

const limitClause = (limit: number | null): string => {
	if (limit === null) {
		return "";
	}
	return `limit ${limit}`;
};

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
 * Assembles a {@link SelectNode}'s clause text: scope construction, scope
 * validation, and clause joining — shared by {@link renderSelect} and
 * {@link renderSelectInto}, which differ only in the optional clause
 * inserted directly after the projection (the plpgsql `into [strict] …`
 * clause, for the latter).
 */
const renderSelectClauses = (
	query: SelectNode,
	outerScope: ReadonlyArray<TableRefNode> | undefined,
	clauseAfterProjection?: string,
): string => {
	const scope = [
		query.from,
		...query.joins.map((join) => join.table),
		...(outerScope ?? []),
	];

	const mentionedRefs = [
		...collectProjectionRefs(query.projection),
		...query.joins.flatMap((join) => collectColumnRefs(join.on)),
		...collectWhereRefs(query.where),
		...query.orderBy.flatMap((term) => collectColumnRefs(term.expr)),
	];
	assertInScope(scope, mentionedRefs, "select from", query.from);

	const joinsSql = query.joins
		.map(
			(join) =>
				`${join.joinKind} join ${renderTableRef(join.table)} on ${renderExpr(join.on, scope)}`,
		)
		.join(" ");

	const clauses = [
		`select ${renderProjection(query.projection, scope)}`,
		clauseAfterProjection ?? "",
		`from ${renderTableRef(query.from)}`,
		joinsSql,
		whereClause(query.where, scope),
		orderByClause(query.orderBy, scope),
		limitClause(query.limit),
	].filter((clause) => clause !== "");

	return clauses.join(" ");
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
): string => renderSelectClauses(query, outerScope);

const intoKeyword = (strict: boolean): string => {
	if (strict) {
		return "into strict";
	}
	return "into";
};

const intoClause = (
	intoVariables: ReadonlyArray<string>,
	strict: boolean,
): string => {
	if (intoVariables.length === 0) {
		return throwHejbroError(
			"empty-into-list",
			"renderSelectInto() received no target variables. Next: pass at least one local name.",
		);
	}
	return `${intoKeyword(strict)} ${intoVariables.join(", ")}`;
};

/**
 * Renders a {@link SelectNode} as a plpgsql `select … into [strict] …`
 * statement — same clause order and scope validation as {@link renderSelect},
 * with the `into` clause inserted directly after the projection (spec §5.3,
 * decision A2).
 */
export const renderSelectInto = (
	query: SelectNode,
	intoVariables: ReadonlyArray<string>,
	options: { readonly strict: boolean },
	outerScope?: ReadonlyArray<TableRefNode>,
): string =>
	renderSelectClauses(
		query,
		outerScope,
		intoClause(intoVariables, options.strict),
	);

/** Renders an {@link InsertNode}. `outerScope` follows the same scope rule as {@link renderSelect} (`[table, …outerScope]`). */
export const renderInsert = (
	node: InsertNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const scope = [node.table, ...(outerScope ?? [])];
	const mentionedRefs = [
		...collectRowsRefs(node.rows),
		...collectOnConflictRefs(node.onConflict),
		...collectReturningRefs(node.returning),
	];
	assertInScope(scope, mentionedRefs, "insert into", node.table);

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
	const mentionedRefs = [
		...collectSetRefs(node.set),
		...collectWhereRefs(node.where),
		...collectReturningRefs(node.returning),
	];
	assertInScope(scope, mentionedRefs, "update", node.table);

	const setSql = node.set
		.map(
			(entry) =>
				`${quoteIdentifier(entry.columnName)} = ${renderExpr(entry.value, scope)}`,
		)
		.join(", ");

	const clauses = [
		`update ${renderTableRef(node.table)} set ${setSql}`,
		whereClause(node.where, scope),
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
	const mentionedRefs = [
		...collectWhereRefs(node.where),
		...collectReturningRefs(node.returning),
	];
	assertInScope(scope, mentionedRefs, "delete from", node.table);

	const clauses = [
		`delete from ${renderTableRef(node.table)}`,
		whereClause(node.where, scope),
		renderReturning(node.returning, scope),
	].filter((clause) => clause !== "");

	return clauses.join(" ");
};

/**
 * One handler per {@link QueryNode} `queryKind`, same technique as
 * `renderExprHandlers` below: a mapped type over the full `queryKind`
 * union, so the object literal must cover every key — a missing one is a
 * compile error, the same guarantee a `switch`'s `default:
 * assertNever(node)` gives at runtime. Applied here for coverage, not
 * complexity (#154 ratchet-5): `renderQuery`'s own `default` branch was
 * structurally unreachable (`QueryNode` has exactly these four kinds), so
 * no test could ever reach it — a handler map has no such branch to leave
 * uncovered.
 */
type RenderQueryHandlers = {
	readonly [K in QueryNode["queryKind"]]: (
		node: Extract<QueryNode, { readonly queryKind: K }>,
		outerScope?: ReadonlyArray<TableRefNode>,
	) => string;
};

/** A branch renders parenthesized when it is itself a set operation — associativity stays explicit in the emitted text, never implied. */
const renderSetOpBranch = (
	branch: SelectNode | SetOpNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	if (branch.queryKind === "setOp") {
		return `(${renderSetOp(branch, outerScope)})`;
	}
	return renderSelect(branch, outerScope);
};

/** The scope a set-op's WHOLE-SET `order by` resolves against: the LEFT branch's own from/joins (recursing through nested set-ops to the leftmost select) — Postgres resolves set-op ordering against output columns, which the left branch names (D103; stricter-than-Postgres honest subset, the `sql` hatch covers positional/alias forms). */
const leftBranchScope = (
	branch: SelectNode | SetOpNode,
): ReadonlyArray<TableRefNode> => {
	if (branch.queryKind === "setOp") {
		return leftBranchScope(branch.left);
	}
	return [branch.from, ...branch.joins.map((join) => join.table)];
};

/** A set-op's whole-set `order by` renders OUTPUT column names, never qualified refs — Postgres resolves set-op ordering against the combined output and REJECTS a table-qualified reference there (measured live, group 4). The scope check above already pinned each term to a left-branch column; here only its bare SQL name is emitted. A non-column term is a loud error — the honest v1 subset (D103), the `sql` hatch covers the rest. */
const setOpOrderByClause = (orderBy: ReadonlyArray<OrderByTerm>): string => {
	if (orderBy.length === 0) {
		return "";
	}
	const rendered = orderBy.map((term) => {
		if (term.expr.nodeKind !== "columnRef") {
			return throwHejbroError(
				"invalid-set-op-order",
				"a set operation's order by accepts only plain column references (the combined output's own columns). Next: order by a left-branch column, or write the statement with sql``.",
			);
		}
		return `"${term.expr.columnName}" ${term.direction}`;
	});
	return `order by ${rendered.join(", ")}`;
};

const setOpKeyword = (node: SetOpNode): string => {
	if (node.all) {
		return `${node.operator} all`;
	}
	return node.operator;
};

/** Renders a {@link SetOpNode}: both branches, the operator keyword, then the whole-set `order by`/`limit` (add-set-operations, D103). */
export const renderSetOp = (
	node: SetOpNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const leftScope = leftBranchScope(node.left);
	const scope = [...leftScope, ...(outerScope ?? [])];
	const orderRefs = node.orderBy.flatMap((term) =>
		collectColumnRefs(term.expr),
	);
	const subject = leftScope[0] ?? { schemaName: "", tableName: "" };
	assertInScope(scope, orderRefs, "order a set operation by", subject);
	const clauses = [
		renderSetOpBranch(node.left, outerScope),
		setOpKeyword(node),
		renderSetOpBranch(node.right, outerScope),
		setOpOrderByClause(node.orderBy),
		limitClause(node.limit),
	].filter((clause) => clause !== "");
	return clauses.join(" ");
};

const renderQueryHandlers: RenderQueryHandlers = {
	select: renderSelect,
	insert: renderInsert,
	update: renderUpdate,
	delete: renderDelete,
	setOp: renderSetOp,
};

/** Dispatches a {@link QueryNode} to its renderer by `queryKind`. */
export const renderQuery = (
	node: QueryNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const handler = renderQueryHandlers[node.queryKind] as (
		node: QueryNode,
		outerScope?: ReadonlyArray<TableRefNode>,
	) => string;
	return handler(node, outerScope);
};

/**
 * Renders an {@link ExprNode} as deterministic SQL text. `outerScope` names
 * the tables an `exists` subquery may correlate against beyond its own
 * `from` — an RLS `using` on `comments` renders with
 * `outerScope = [comments]`, letting a nested
 * `exists (select 1 from posts where posts.id = comments.post_id)` pass
 * scope validation (see {@link renderSelect}).
 */
type OuterScope = ReadonlyArray<TableRefNode> | undefined;

const renderColumnRefNode = (node: ColumnRefNode): string =>
	`${qualifyName(node.schemaName, node.tableName)}.${quoteIdentifier(node.columnName)}`;

const renderPlpgsqlRefNode = (node: PlpgsqlRefNode): string =>
	node.path.join(".");

const renderComparisonNode = (
	node: ComparisonNode,
	outerScope: OuterScope,
): string =>
	`${renderOperand(node.left, outerScope)} ${node.operator} ${renderOperand(node.right, outerScope)}`;

const renderLogicalNode = (
	node: LogicalNode,
	outerScope: OuterScope,
): string => {
	if (node.operands.length === 0) {
		return throwHejbroError(
			"empty-logical-expression",
			"and()/or() need at least one operand. Next: pass at least one boolean expression.",
		);
	}
	return node.operands
		.map((operand) => renderOperand(operand, outerScope))
		.join(` ${node.operator} `);
};

const renderNotNode = (node: NotNode, outerScope: OuterScope): string =>
	`not ${renderOperand(node.operand, outerScope)}`;

const renderNullTestNode = (
	node: NullTestNode,
	outerScope: OuterScope,
): string => {
	const suffix = nullTestKeyword(node.negated);
	return `${renderOperand(node.operand, outerScope)} ${suffix}`;
};

const renderInListNode = (node: InListNode, outerScope: OuterScope): string => {
	if (node.values.length === 0) {
		return throwHejbroError(
			"empty-in-list",
			"inArray() received an empty array — an empty in-list is always false in SQL. Next: drop the condition or supply values.",
		);
	}
	const keyword = inListKeyword(node.negated);
	const values = node.values
		.map((value) => renderExpr(value, outerScope))
		.join(", ");
	return `${renderOperand(node.operand, outerScope)} ${keyword} (${values})`;
};

const renderBetweenNode = (
	node: BetweenNode,
	outerScope: OuterScope,
): string => {
	const keyword = betweenKeyword(node.negated);
	return `${renderOperand(node.operand, outerScope)} ${keyword} ${renderOperand(node.lowerBound, outerScope)} and ${renderOperand(node.upperBound, outerScope)}`;
};

const renderFunctionCallNode = (
	node: FunctionCallNode,
	outerScope: OuterScope,
): string => {
	const name = qualifiedFunctionName(node.schemaName, node.functionName);
	const args = node.args.map((arg) => renderExpr(arg, outerScope)).join(", ");
	return `${name}(${args})`;
};

const renderSqlTemplateNode = (
	node: SqlTemplateNode,
	outerScope: OuterScope,
): string =>
	node.chunks
		.map((chunk) => renderSqlTemplateChunk(chunk, outerScope))
		.join("");

const renderRawSqlNode = (node: RawSqlNode): string => node.sql;

const renderExistsNode = (node: ExistsNode, outerScope: OuterScope): string => {
	const keyword = existsKeyword(node.negated);
	return `${keyword} (${renderSelect(node.query, outerScope)})`;
};

const renderSelectExprNode = (
	node: SelectExprNode,
	outerScope: OuterScope,
): string => {
	const inner = renderSelect(node.query, outerScope);
	if (node.mode === "jsonArray") {
		return `(select coalesce(json_agg("agg"), '[]'::json) from (${inner}) as "agg")`;
	}
	return `(select row_to_json("agg") from (${inner}) as "agg")`;
};

/**
 * One handler per {@link ExprNode} `nodeKind` for {@link renderExpr} — a
 * mapped type over the full `nodeKind` union, not a hand-written list, so
 * a missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(node)` would have been (verified directly with a
 * scratch dummy-variant edit, #154 PR2).
 */
type RenderExprHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
		outerScope: OuterScope,
	) => string;
};

const renderExprHandlers: RenderExprHandlers = {
	literal: renderLiteral,
	columnRef: renderColumnRefNode,
	plpgsqlRef: renderPlpgsqlRefNode,
	comparison: renderComparisonNode,
	logical: renderLogicalNode,
	not: renderNotNode,
	nullTest: renderNullTestNode,
	inList: renderInListNode,
	between: renderBetweenNode,
	functionCall: renderFunctionCallNode,
	sqlTemplate: renderSqlTemplateNode,
	rawSql: renderRawSqlNode,
	exists: renderExistsNode,
	selectExpr: renderSelectExprNode,
};

export const renderExpr = (
	node: ExprNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	const handler = renderExprHandlers[node.nodeKind] as (
		node: ExprNode,
		outerScope: OuterScope,
	) => string;
	return handler(node, outerScope);
};
