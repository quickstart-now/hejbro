import { assertNever, throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type {
	BetweenNode,
	ColumnRefNode,
	ComparisonNode,
	CteRefNode,
	DeleteNode,
	DistinctNode,
	ExistsNode,
	ExprNode,
	FromNode,
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
	WindowNode,
	WithEntryNode,
	WithNode,
} from "./ast";
import { renderLiteral } from "./literal";
import { selectChildExprs } from "./select-children";

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
	outerScope: ReadonlyArray<FromNode> | undefined,
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
	outerScope: ReadonlyArray<FromNode> | undefined,
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

/** A CTE reference has no schema (D105) — narrows a {@link FromNode} by the field only {@link CteRefNode} carries. */
const isCteRef = (node: FromNode): node is CteRefNode => "cteName" in node;

/** Renders a {@link FromNode}: a CTE reference bare and quoted (add-ctes, task 1.2), a table reference schema-qualified. */
export const renderFromNode = (node: FromNode): string => {
	if (isCteRef(node)) {
		return quoteIdentifier(node.cteName);
	}
	return renderTableRef(node);
};

/** Human-readable identity for a diagnostic message — `schema.table` for a table, the bare name for a CTE. */
const describeFromNode = (node: FromNode): string => {
	if (isCteRef(node)) {
		return node.cteName;
	}
	return `${node.schemaName}.${node.tableName}`;
};

/** Human-readable identity for a diagnostic message — `schema.table.column` for a table column, `cte.column` for a CTE column (`schemaName === null`). */
const describeColumnRef = (ref: ColumnRefNode): string => {
	if (ref.schemaName === null) {
		return `${ref.tableName}.${ref.columnName}`;
	}
	return `${ref.schemaName}.${ref.tableName}.${ref.columnName}`;
};

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
	window: (node) => [
		...collectColumnRefs(node.fn),
		...node.partitionBy.flatMap(collectColumnRefs),
		...node.orderBy.flatMap((term) => collectColumnRefs(term.expr)),
	],
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
	scope: ReadonlyArray<FromNode>,
	ref: ColumnRefNode,
): boolean =>
	scope.some((source) => {
		if (isCteRef(source)) {
			return ref.schemaName === null && ref.tableName === source.cteName;
		}
		return (
			ref.schemaName === source.schemaName && ref.tableName === source.tableName
		);
	});

const findForeignColumnRef = (
	scope: ReadonlyArray<FromNode>,
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
	scope: ReadonlyArray<FromNode>,
	refs: ReadonlyArray<ColumnRefNode>,
	verb: string,
	subject: FromNode,
): void => {
	const badRef = findForeignColumnRef(scope, refs);
	if (badRef !== undefined) {
		throwHejbroError(
			"foreign-column-ref",
			// add-ctes task 1.3 owns this message's final wording for a CTE
			// subject/reference; describeFromNode/describeColumnRef keep it
			// truthful (no bare "null.table") in the meantime.
			`${verb} "${describeFromNode(subject)}" references column "${describeColumnRef(badRef)}". Next: join that table, or reference it from an enclosing query via exists().`,
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
	scope: ReadonlyArray<FromNode>,
): string => {
	if (where === null) {
		return "";
	}
	return `where ${renderExpr(where, scope)}`;
};

/** Shared by a select's own `order by` and a window clause's `order by` — both are the exact same shape (`OrderByTerm[]`), rendered the exact same way. */
const orderByClause = (
	orderBy: ReadonlyArray<OrderByTerm>,
	scope: OuterScope,
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

const groupByClause = (
	groupBy: ReadonlyArray<ExprNode>,
	scope: OuterScope,
): string => {
	if (groupBy.length === 0) {
		return "";
	}
	return `group by ${groupBy.map((term) => renderExpr(term, scope)).join(", ")}`;
};

const havingClause = (having: ExprNode | null, scope: OuterScope): string => {
	if (having === null) {
		return "";
	}
	return `having ${renderExpr(having, scope)}`;
};

const offsetClause = (offset: number | null): string => {
	if (offset === null) {
		return "";
	}
	return `offset ${offset}`;
};

/** `distinct` / `distinct on (...)` — rendered between `select` and the projection, where SQL puts it. */
const distinctKeyword = (
	distinct: DistinctNode | null,
	scope: OuterScope,
): string => {
	if (distinct === null) {
		return "select";
	}
	if (distinct.distinctKind === "all") {
		return "select distinct";
	}
	const columns = distinct.columns
		.map((column) => renderExpr(column, scope))
		.join(", ");
	return `select distinct on (${columns})`;
};

const renderProjection = (
	projection: ProjectionNode,
	scope: ReadonlyArray<FromNode>,
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
	scope: ReadonlyArray<FromNode>,
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
	scope: ReadonlyArray<FromNode>,
): string => {
	if (onConflict === null) {
		return "";
	}
	const targetSql = onConflict.targetColumns.map(quoteIdentifier).join(", ");
	return `on conflict (${targetSql}) ${renderOnConflictAction(onConflict.action, scope)}`;
};

const renderReturning = (
	returning: ReturningNode | null,
	scope: ReadonlyArray<FromNode>,
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
	outerScope: ReadonlyArray<FromNode> | undefined,
	clauseAfterProjection?: string,
): string => {
	const scope = [
		query.from,
		...query.joins.map((join) => join.table),
		...(outerScope ?? []),
	];
	assertCtesVisible(outerScope, [
		query.from,
		...query.joins.map((join) => join.table),
	]);

	// #444 F2: every clause's refs, via the same table walk.ts/params.ts
	// consume — a hand-written list here is exactly what let
	// groupBy/having/distinct on's refs go unchecked when #438/#443 added
	// them.
	const mentionedRefs = selectChildExprs(query).flatMap(collectColumnRefs);
	assertInScope(scope, mentionedRefs, "select from", query.from);

	const joinsSql = query.joins
		.map(
			(join) =>
				`${join.joinKind} join ${renderFromNode(join.table)} on ${renderExpr(join.on, scope)}`,
		)
		.join(" ");

	const clauses = [
		`${distinctKeyword(query.distinct, scope)} ${renderProjection(query.projection, scope)}`,
		clauseAfterProjection ?? "",
		`from ${renderFromNode(query.from)}`,
		joinsSql,
		whereClause(query.where, scope),
		groupByClause(query.groupBy, scope),
		havingClause(query.having, scope),
		orderByClause(query.orderBy, scope),
		limitClause(query.limit),
		offsetClause(query.offset),
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
	outerScope?: ReadonlyArray<FromNode>,
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
	outerScope?: ReadonlyArray<FromNode>,
): string =>
	renderSelectClauses(
		query,
		outerScope,
		intoClause(intoVariables, options.strict),
	);

/** Renders an {@link InsertNode}. `outerScope` follows the same scope rule as {@link renderSelect} (`[table, …outerScope]`). */
export const renderInsert = (
	node: InsertNode,
	outerScope?: ReadonlyArray<FromNode>,
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
	outerScope?: ReadonlyArray<FromNode>,
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
	outerScope?: ReadonlyArray<FromNode>,
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
		outerScope?: ReadonlyArray<FromNode>,
	) => string;
};

/** A branch renders parenthesized when it is itself a set operation — associativity stays explicit in the emitted text, never implied. */
const renderSetOpBranch = (
	branch: SelectNode | SetOpNode,
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	if (branch.queryKind === "setOp") {
		return `(${renderSetOp(branch, outerScope)})`;
	}
	return renderSelect(branch, outerScope);
};

/** The leftmost select's OUTPUT column names — what Postgres resolves a set-op's whole-set `order by` against (measured live, group 4: a table-qualified or non-output reference is an ERROR there, so the guard checks membership in THIS list, never a table scope). */
const leftBranchOutputColumns = (
	branch: SelectNode | SetOpNode,
): ReadonlyArray<string> => {
	if (branch.queryKind === "setOp") {
		return leftBranchOutputColumns(branch.left);
	}
	if (branch.projection.projectionKind === "allColumns") {
		return branch.projection.columnNames;
	}
	if (branch.projection.projectionKind === "columns") {
		return branch.projection.columns.map((column) => column.alias);
	}
	return [];
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
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	const outputColumns = leftBranchOutputColumns(node.left);
	const badTerm = node.orderBy
		.flatMap((term) => collectColumnRefs(term.expr))
		.find((ref) => !outputColumns.includes(ref.columnName));
	if (badTerm !== undefined) {
		throwHejbroError(
			"invalid-set-op-order",
			`a set operation's order by references "${badTerm.columnName}", which is not one of the combined output's columns (${outputColumns.map((name) => `"${name}"`).join(", ")}) — Postgres resolves set-op ordering against the output list only. Next: order by a projected left-branch column (by its output name), or write the statement with sql\`\`.`,
		);
	}
	const clauses = [
		renderSetOpBranch(node.left, outerScope),
		setOpKeyword(node),
		renderSetOpBranch(node.right, outerScope),
		setOpOrderByClause(node.orderBy),
		limitClause(node.limit),
		offsetClause(node.offset),
	].filter((clause) => clause !== "");
	return clauses.join(" ");
};

/** Renders a `WITH` entry's or body's query without adding parentheses — the caller decides whether parens are needed (an entry always gets them, the body never does at top level). */
const renderQueryBody = (
	node: SelectNode | SetOpNode,
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	if (node.queryKind === "setOp") {
		return renderSetOp(node, outerScope);
	}
	return renderSelect(node, outerScope);
};

/** `null` renders neither token, leaving the choice to the planner (Postgres's default); `true`/`false` render their own. */
const materializedKeyword = (materialized: boolean | null): string => {
	if (materialized === true) {
		return "materialized ";
	}
	if (materialized === false) {
		return "not materialized ";
	}
	return "";
};

const renderWithEntry = (
	entry: WithEntryNode,
	outerScope?: ReadonlyArray<FromNode>,
): string =>
	`${quoteIdentifier(entry.name)} as ${materializedKeyword(entry.materialized)}(${renderQueryBody(entry.query, outerScope)})`;

const recursiveKeyword = (recursive: boolean): string => {
	if (recursive) {
		return "recursive ";
	}
	return "";
};

/**
 * Throws `undeclared-cte` when `targets` names a CTE that is not among
 * `outerScope`'s own CTE markers. The skip is gated on "are there any CTE
 * targets to check" (task 1.3c), not on whether `outerScope` is defined:
 * a from/join list with no CTE reference at all never reads `outerScope`,
 * which is what keeps every existing table-only render — bare or
 * correlated — unaffected; a CTE reference with an `undefined` or
 * CTE-marker-less `outerScope` means literally nothing is visible, which
 * is exactly `undeclared-cte`'s own case, not a reason to look away
 * (rendering that select stand-alone would otherwise name a relation no
 * `WITH` ever declares, passing here only to fail on the server with no
 * diagnostic). `renderWith` is the only producer of a scope carrying CTE
 * markers, and every render call already threads `outerScope` down
 * through `exists()`/`selectExpr()` (`renderExistsNode`/
 * `renderSelectExprNode` pass it straight through to their own nested
 * `renderSelect`), so calling this once here — the one place every
 * select's own `from`/joins are assembled, top-level or nested — reaches
 * a from/join target buried inside a subquery too, with no separate
 * traversal: a single code covers task 1.3 (a name the statement never
 * declares at all), task 1.4 (a name it declares, but not yet visible
 * from here — `renderWith` narrows `outerScope`'s markers to the earlier
 * entries only when rendering an entry), task 1.3b (a target inside a
 * nested `exists()`/`selectExpr()` subquery), and task 1.3c (a CTE
 * reference rendered with no enclosing `WITH` in sight at all — a
 * reference object escaping the statement that declared it, reachable
 * once group 3 hands one out). Not `foreign-column-ref`'s family: that
 * family names a *column* mismatched against a resolved table; this is a
 * from/join target naming a relation that either does not exist or is
 * not visible yet, which needs its own available-sources listing, not a
 * "join that table" suggestion that does not apply to a CTE.
 */
const assertCtesVisible = (
	outerScope: ReadonlyArray<FromNode> | undefined,
	targets: ReadonlyArray<FromNode>,
): void => {
	const cteTargets = targets.filter(isCteRef);
	if (cteTargets.length === 0) {
		return;
	}
	const visibleNames = (outerScope ?? [])
		.filter(isCteRef)
		.map((ref) => ref.cteName);
	const undeclaredRef = cteTargets.find(
		(ref) => !visibleNames.includes(ref.cteName),
	);
	if (undeclaredRef === undefined) {
		return;
	}
	const available = visibleNames.map((name) => `"${name}"`).join(", ");
	throwHejbroError(
		"undeclared-cte",
		`with statement references "${undeclaredRef.cteName}", which is not declared and visible here — visible: ${available || "(none)"}. Next: add "${undeclaredRef.cteName}" to the with() list ahead of this reference, or reference one of the visible CTEs instead.`,
	);
};

/** `entry`/`body` markers for {@link renderWith}'s own `outerScope` injection: a bare CTE name becomes the minimal {@link CteRefNode} shape {@link assertCtesVisible} reads back out. */
const cteMarkers = (names: ReadonlyArray<string>): ReadonlyArray<CteRefNode> =>
	names.map((cteName) => ({ cteName }));

/** Renders a {@link WithNode}: its entries comma-separated in declaration order, `with recursive` when the list is recursive, then the body — never itself parenthesized (add-ctes, task 1.1). */
export const renderWith = (
	node: WithNode,
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	const declaredNames = node.ctes.map((entry) => entry.name);
	const entriesSql = node.ctes
		.map((entry, index) => {
			// Without RECURSIVE, entry n sees only the entries before it
			// (task 1.4) — forward reference is unrepresentable by the
			// builder (each entry is handed only the earlier references),
			// so this guards the artifact path, not the builder path.
			const entryScope = [
				...cteMarkers(declaredNames.slice(0, index)),
				...(outerScope ?? []),
			];
			return renderWithEntry(entry, entryScope);
		})
		.join(", ");
	const bodyScope = [...cteMarkers(declaredNames), ...(outerScope ?? [])];
	return `with ${recursiveKeyword(node.recursive)}${entriesSql} ${renderQueryBody(node.body, bodyScope)}`;
};

const renderQueryHandlers: RenderQueryHandlers = {
	select: renderSelect,
	insert: renderInsert,
	update: renderUpdate,
	delete: renderDelete,
	setOp: renderSetOp,
	with: renderWith,
};

/** Dispatches a {@link QueryNode} to its renderer by `queryKind`. */
export const renderQuery = (
	node: QueryNode,
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	const handler = renderQueryHandlers[node.queryKind] as (
		node: QueryNode,
		outerScope?: ReadonlyArray<FromNode>,
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
type OuterScope = ReadonlyArray<FromNode> | undefined;

/** A CTE column reference (`schemaName === null`, add-ctes) qualifies by the bare CTE name only — a CTE has no schema to render. */
const renderColumnRefNode = (node: ColumnRefNode): string => {
	if (node.schemaName === null) {
		return `${quoteIdentifier(node.tableName)}.${quoteIdentifier(node.columnName)}`;
	}
	return `${qualifyName(node.schemaName, node.tableName)}.${quoteIdentifier(node.columnName)}`;
};

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

/** `partition by …` — the window clause's own first sub-clause, omitted when empty (D104: rendering nothing under an empty spec is exactly Postgres's default). */
const partitionByClause = (
	partitionBy: ReadonlyArray<ExprNode>,
	outerScope: OuterScope,
): string => {
	if (partitionBy.length === 0) {
		return "";
	}
	const columns = partitionBy
		.map((column) => renderExpr(column, outerScope))
		.join(", ");
	return `partition by ${columns}`;
};

/** `<fn>(…) over (partition by … order by …)` — clause order and omission follow SQL's own `over (...)` grammar (D104). */
const renderWindowNode = (node: WindowNode, outerScope: OuterScope): string => {
	const fnSql = renderFunctionCallNode(node.fn, outerScope);
	const overClauses = [
		partitionByClause(node.partitionBy, outerScope),
		orderByClause(node.orderBy, outerScope),
	].filter((clause) => clause !== "");
	return `${fnSql} over (${overClauses.join(" ")})`;
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
	window: renderWindowNode,
};

export const renderExpr = (
	node: ExprNode,
	outerScope?: ReadonlyArray<FromNode>,
): string => {
	const handler = renderExprHandlers[node.nodeKind] as (
		node: ExprNode,
		outerScope: OuterScope,
	) => string;
	return handler(node, outerScope);
};
