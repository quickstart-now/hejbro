import type { Table } from "../dsl/table";
import { getTableMeta, isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	Condition,
	Expr,
	ExprNode,
	JoinKind,
	OrderTermInput,
	ProjectionNode,
	SelectNode,
	SetOpNode,
	TableRefNode,
} from "../expr/ast";
import { expr, resolveOrderTerm } from "../expr/ast";
import { someExprNode } from "../expr/walk";
import type { TypeNode } from "../types/type-node";

/** A `select()` projection: the whole table (deterministic column list), or an object of aliased expressions. */
export type SelectProjection = Table | Record<string, Expr>;

/**
 * Re-exported for backward compatibility (and for `@hejbro/query`'s chain
 * set-op stage, which imports both from here) — the type and its resolver
 * now live in `expr/ast.ts` (group 3, D104): `expr/window.ts` needed the
 * exact same order-term shape for `over()`'s spec, and `expr/` cannot
 * depend on `query/` (the reverse holds throughout this package), so a
 * second real consumer promoted the shared shape up rather than adding a
 * second hand-kept duplicate.
 */
export type { OrderTermInput };
export { resolveOrderTerm };

/** A combined set-operation stage (add-set-operations, D103): carries the recursive node, whole-set `orderBy`/`limit`, and further combinators — so `(a union b) except c` chains naturally. */
export type SetOpStage<
	TProjection extends SelectProjection = SelectProjection,
> = {
	readonly setOpQuery: SetOpNode;
	readonly projectionInput: TProjection;
	union(other: SetOpBranch): SetOpStage<TProjection>;
	unionAll(other: SetOpBranch): SetOpStage<TProjection>;
	intersect(other: SetOpBranch): SetOpStage<TProjection>;
	intersectAll(other: SetOpBranch): SetOpStage<TProjection>;
	except(other: SetOpBranch): SetOpStage<TProjection>;
	exceptAll(other: SetOpBranch): SetOpStage<TProjection>;
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SetOpStage<TProjection>;
	limit(count: number): SetOpStage<TProjection>;
};

/** What a combinator accepts as its other side: any select stage, or a prior combination. */
export type SetOpBranch<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection> | SetOpStage<TProjection>;

/** The six combinators every select stage carries (and every {@link SetOpStage} carries again). */
export type SetOpCombinators<TProjection extends SelectProjection> = {
	union(other: SetOpBranch): SetOpStage<TProjection>;
	unionAll(other: SetOpBranch): SetOpStage<TProjection>;
	intersect(other: SetOpBranch): SetOpStage<TProjection>;
	intersectAll(other: SetOpBranch): SetOpStage<TProjection>;
	except(other: SetOpBranch): SetOpStage<TProjection>;
	exceptAll(other: SetOpBranch): SetOpStage<TProjection>;
};

export type SelectLimited<
	TProjection extends SelectProjection = SelectProjection,
> = {
	readonly selectQuery: SelectNode;
	readonly fromTable: Table;
	readonly projectionInput: TProjection;
} & SetOpCombinators<TProjection>;
export type SelectOffsetted<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection>;
export type SelectOrdered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection> & {
	limit(count: number): SelectLimitedThenOffset<TProjection>;
	/** `offset` without a `limit` is legal SQL and useful on its own. */
	offset(count: number): SelectOffsetted<TProjection>;
};
export type SelectLimitedThenOffset<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection> & {
	offset(count: number): SelectOffsetted<TProjection>;
};
/** After `having`: `order by`/`limit`/`offset` still follow, `group by` and a second `having` do not. */
export type SelectHaving<
	TProjection extends SelectProjection = SelectProjection,
> = SelectOrdered<TProjection> & {
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectOrdered<TProjection>;
};
export type SelectGrouped<
	TProjection extends SelectProjection = SelectProjection,
> = SelectHaving<TProjection> & {
	/** Filters GROUPS, after aggregation — `where` filters rows before it. */
	having(condition: Condition): SelectHaving<TProjection>;
};
export type SelectFiltered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectOrdered<TProjection> & {
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectOrdered<TProjection>;
	groupBy(...terms: ReadonlyArray<Expr>): SelectGrouped<TProjection>;
};
export type SelectJoinable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectFiltered<TProjection> & {
	innerJoin(joined: Table, on: Condition): SelectJoinable<TProjection>;
	leftJoin(joined: Table, on: Condition): SelectJoinable<TProjection>;
	where(condition: Condition): SelectFiltered<TProjection>;
};
/**
 * What `select()` itself returns: a joinable stage that can still take
 * `distinct`. SQL puts `distinct` between `select` and the projection, so
 * the chain does too — it is available first and exactly once, and every
 * later stage is a plain {@link SelectJoinable}.
 */
export type SelectDistinctable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectJoinable<TProjection> & {
	distinct(): SelectJoinable<TProjection>;
	distinctOn(...columns: ReadonlyArray<Expr>): SelectJoinable<TProjection>;
};

const tableRefOf = (target: Table): TableRefNode => {
	const meta = getTableMeta(target);
	return { schemaName: meta.schema.schemaName, tableName: meta.tableName };
};

const appendJoin = (
	query: SelectNode,
	joinKind: JoinKind,
	joined: Table,
	on: Condition,
): SelectNode => ({
	...query,
	joins: [
		...query.joins,
		{ joinKind, table: tableRefOf(joined), on: on.exprNode },
	],
});

const branchNode = (branch: SetOpBranch): SelectNode | SetOpNode => {
	if ("setOpQuery" in branch) {
		return branch.setOpQuery;
	}
	return branch.selectQuery;
};

const combineSetOp = <TProjection extends SelectProjection>(
	left: SelectNode | SetOpNode,
	operator: SetOpNode["operator"],
	all: boolean,
	other: SetOpBranch,
	projectionInput: TProjection,
): SetOpStage<TProjection> =>
	makeSetOpStage(
		{
			queryKind: "setOp",
			operator,
			all,
			left,
			right: branchNode(other),
			orderBy: [],
			limit: null,
			offset: null,
		},
		projectionInput,
	);

/** The runtime combinator set over `left` — shared by every select stage and by {@link makeSetOpStage} itself (further chaining re-combines the whole node). */
const setOpCombinators = <TProjection extends SelectProjection>(
	left: () => SelectNode | SetOpNode,
	projectionInput: TProjection,
): SetOpCombinators<TProjection> => ({
	union: (other) =>
		combineSetOp(left(), "union", false, other, projectionInput),
	unionAll: (other) =>
		combineSetOp(left(), "union", true, other, projectionInput),
	intersect: (other) =>
		combineSetOp(left(), "intersect", false, other, projectionInput),
	intersectAll: (other) =>
		combineSetOp(left(), "intersect", true, other, projectionInput),
	except: (other) =>
		combineSetOp(left(), "except", false, other, projectionInput),
	exceptAll: (other) =>
		combineSetOp(left(), "except", true, other, projectionInput),
});

const makeSetOpStage = <TProjection extends SelectProjection>(
	node: SetOpNode,
	projectionInput: TProjection,
): SetOpStage<TProjection> => ({
	setOpQuery: node,
	projectionInput,
	...setOpCombinators(() => node, projectionInput),
	orderBy: (...terms) =>
		makeSetOpStage(
			{ ...node, orderBy: [...node.orderBy, ...terms.map(resolveOrderTerm)] },
			projectionInput,
		),
	limit: (count) => makeSetOpStage({ ...node, limit: count }, projectionInput),
});

/** `limit`/`offset` take the same non-negative integer and render inline, never as a bind parameter — one validator, so the two can never drift on what they accept. */
const assertRowCount = (count: number, clause: "limit" | "offset"): void => {
	if (!Number.isInteger(count) || count < 0) {
		throwHejbroError(
			`invalid-${clause}`,
			`${clause}(${count}) must be a non-negative integer. Next: pass a non-negative integer, e.g. ${clause}(10).`,
		);
	}
};

const isWindowNode = (node: ExprNode): boolean => node.nodeKind === "window";

/**
 * Rejects `where()`/`groupBy()`/`having()` arguments containing a window
 * function (D104) — Postgres evaluates window functions after all three
 * clauses run, so their result isn't available there yet (`42P20`). Uses
 * the SHALLOW `someExprNode` (the `exists`-rejection precedent,
 * `dsl/table.ts`'s `validateChecks`): a window function inside an
 * `exists()` subquery's own select list is a different, legal query, not
 * this one's clause. `distinctOn` deliberately has no such guard —
 * Postgres accepts a window function there (measured on postgres:17;
 * `distinct on` counts as part of the select list).
 */
const assertNoWindowFunction = (
	clause: "where" | "group by" | "having",
	exprs: ReadonlyArray<ExprNode>,
): void => {
	if (exprs.some((node) => someExprNode(node, isWindowNode))) {
		throwHejbroError(
			"window-function-not-allowed",
			`a ${clause} clause cannot reference a window function — Postgres evaluates window functions after ${clause} runs, so its result isn't available there yet. Next: move the window function into the select list instead, or filter on it from an outer query.`,
		);
	}
};

const makeStages = <TProjection extends SelectProjection>(
	query: SelectNode,
	fromTable: Table,
	projectionInput: TProjection,
	// Every stage member exists on the one object `makeStages` builds; the
	// STAGE TYPES are what hide the ones SQL wouldn't allow next. The
	// intersection here is what lets `groupBy` return a grouped stage
	// without a second builder that would have to stay in sync.
): SelectJoinable<TProjection> & SelectGrouped<TProjection> => ({
	selectQuery: query,
	fromTable,
	projectionInput,
	...setOpCombinators(() => query, projectionInput),
	innerJoin: (joined, on) =>
		makeStages(
			appendJoin(query, "inner", joined, on),
			fromTable,
			projectionInput,
		),
	leftJoin: (joined, on) =>
		makeStages(
			appendJoin(query, "left", joined, on),
			fromTable,
			projectionInput,
		),
	where: (condition) => {
		assertNoWindowFunction("where", [condition.exprNode]);
		return makeStages(
			{ ...query, where: condition.exprNode },
			fromTable,
			projectionInput,
		);
	},
	orderBy: (...terms) =>
		makeStages(
			{ ...query, orderBy: terms.map(resolveOrderTerm) },
			fromTable,
			projectionInput,
		),
	groupBy: (...terms) => {
		if (terms.length === 0) {
			return throwHejbroError(
				"empty-group-by",
				"groupBy() needs at least one expression. Next: pass the columns the aggregate is grouped by, e.g. groupBy(posts.authorId).",
			);
		}
		assertNoWindowFunction(
			"group by",
			terms.map((term) => term.exprNode),
		);
		return makeStages(
			{ ...query, groupBy: terms.map((term) => term.exprNode) },
			fromTable,
			projectionInput,
		);
	},
	having: (condition: Condition) => {
		assertNoWindowFunction("having", [condition.exprNode]);
		return makeStages(
			{ ...query, having: condition.exprNode },
			fromTable,
			projectionInput,
		);
	},
	limit: (count) => {
		assertRowCount(count, "limit");
		return makeStages({ ...query, limit: count }, fromTable, projectionInput);
	},
	offset: (count) => {
		assertRowCount(count, "offset");
		return makeStages({ ...query, offset: count }, fromTable, projectionInput);
	},
});

/**
 * What `select()` returns — {@link makeStages} plus the two `distinct`
 * members, which every later stage drops (SQL allows `distinct` only
 * between `select` and the projection, so the chain allows it exactly
 * once, first).
 */
const makeDistinctableStages = <TProjection extends SelectProjection>(
	query: SelectNode,
	fromTable: Table,
	projectionInput: TProjection,
): SelectDistinctable<TProjection> => ({
	...makeStages(query, fromTable, projectionInput),
	distinct: () =>
		makeStages(
			{ ...query, distinct: { distinctKind: "all" } },
			fromTable,
			projectionInput,
		),
	distinctOn: (...columns) => {
		if (columns.length === 0) {
			return throwHejbroError(
				"empty-distinct-on",
				"distinctOn() needs at least one column. Next: pass the columns one row per group is taken for, e.g. distinctOn(posts.authorId), and order by those columns first.",
			);
		}
		return makeStages(
			{
				...query,
				distinct: {
					distinctKind: "on",
					columns: columns.map((column) => column.exprNode),
				},
			},
			fromTable,
			projectionInput,
		);
	},
});

type ResolvedProjection = {
	readonly projectionNode: ProjectionNode;
	readonly fromTable: Table;
};

const resolveProjection = (
	projection: SelectProjection,
	from: Table | undefined,
): ResolvedProjection => {
	if (isTable(projection)) {
		const meta = getTableMeta(projection);
		return {
			projectionNode: {
				projectionKind: "allColumns",
				columnNames: meta.columns.map((column) => column.columnName),
			},
			fromTable: projection,
		};
	}
	if (from === undefined) {
		return throwHejbroError(
			"missing-from-table",
			"select() with an object projection can't infer the from table. Next: pass it as the second argument: select({ … }, posts).",
		);
	}
	return {
		projectionNode: {
			projectionKind: "columns",
			// `alias` is what rendering emits -- snake, a result-set label in
			// the SQL medium (and, through defineView, a view's column name).
			// `resultKey` keeps the caller's verbatim TS key so the query
			// layer can key converted rows by it (#339); it never reaches SQL
			// text or a stored snapshot (the expression codec drops it).
			columns: Object.entries(projection).map(([alias, value]) => ({
				alias: toSnakeCase(alias),
				resultKey: alias,
				expr: value.exprNode,
			})),
		},
		fromTable: from,
	};
};

/**
 * Starts a `select` query. `select(table)` projects every declared column
 * (an explicit list, not `*`, so `add column` stays deterministic);
 * `select({ alias: expr, … }, table)` projects an object of expressions —
 * `table` is required in that form since it can't be inferred.
 */
export const select = <TProjection extends SelectProjection>(
	projection: TProjection,
	from?: Table,
): SelectDistinctable<TProjection> => {
	const { projectionNode, fromTable } = resolveProjection(projection, from);
	return makeDistinctableStages(
		{
			queryKind: "select",
			projection: projectionNode,
			from: tableRefOf(fromTable),
			joins: [],
			where: null,
			groupBy: [],
			having: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		},
		fromTable,
		projection,
	);
};

/**
 * Type names whose values do not survive a JSON round-trip untouched —
 * exactly the JSON-number precision problem: `bigint`/`numeric` collapse
 * to a lossy JSON number past 2^53, so they cast to text (D102,
 * cast+revive; F1 owner ruling at group 2 review). Nothing else is cast:
 * temporal values JSON-encode as ISO-8601 regardless of the session's
 * `DateStyle` (measured — a text cast would instead FOLLOW `DateStyle`
 * and lose that stability), `interval` is deterministic because the
 * driver pins `intervalstyle` at session setup, and `bytea` rides the
 * driver's `bytea_output` pin (a text cast obeys the same GUC, buying
 * nothing).
 */
const JSON_AT_RISK_TYPE_NAMES: ReadonlySet<string> = new Set([
	"bigint",
	"numeric",
]);

const jsonSafeCastSuffix = (typeNode: TypeNode): string | null => {
	if (typeNode.typeName === "array") {
		if (JSON_AT_RISK_TYPE_NAMES.has(typeNode.element.typeName)) {
			return "::text[]";
		}
		return null;
	}
	if (JSON_AT_RISK_TYPE_NAMES.has(typeNode.typeName)) {
		return "::text";
	}
	return null;
};

const castExprNode = (expr: ExprNode, suffix: string): ExprNode => ({
	nodeKind: "sqlTemplate",
	chunks: [
		{ chunkKind: "expr", expr },
		{ chunkKind: "text", text: suffix },
	],
});

/** The chain's original projection value for one rendered column, or `undefined` when the column carries no `resultKey` (a decoded node) or the input has no such key. */
const inputValueFor = (
	projectionInput: Record<string, unknown>,
	resultKey: string | undefined,
): unknown => {
	if (resultKey === undefined) {
		return undefined;
	}
	return projectionInput[resultKey];
};

const typeNodeOf = (inputValue: unknown): TypeNode | undefined =>
	(inputValue as { readonly typeNode?: TypeNode } | undefined)?.typeNode;

/**
 * The builder's own unqualified aggregate function name, or `undefined`
 * for anything else — a schema-qualified call is a declared function
 * (`db.fn`), which may legitimately be named `count`/`min`/`max` in
 * someone's own schema and must not be treated as the builder's
 * aggregate, and a non-`functionCall` expr obviously isn't one either.
 * Split out (D71/#154 ratchet-5) so {@link isCountCall}/{@link
 * isPassthroughAggregateCall} each stay a single comparison instead of
 * repeating this same two-part shape guard.
 */
const builderAggregateFunctionName = (expr: ExprNode): string | undefined => {
	if (expr.nodeKind !== "functionCall") {
		return undefined;
	}
	if (expr.schemaName !== null) {
		return undefined;
	}
	return expr.functionName;
};

/**
 * `count()` is always `bigint` — Postgres's `int8`, whatever it counted —
 * unconditionally at risk with no `typeNode` to check: unlike `min`/`max`
 * (#444 F9's `Aggregated<TExpr>`), `count()`'s own return type carries no
 * backing `typeNode` at all, only the `ReadAs<bigint>` brand (#416).
 * Mirrors `@hejbro/query`'s `convert.ts`'s own `COUNT_STATE` — the same
 * "count reads back as bigint" fact, on the read side of this cast's
 * write side.
 */
const isCountCall = (expr: ExprNode): boolean =>
	builderAggregateFunctionName(expr) === "count";

/**
 * `min`/`max` read back as their argument's own type, so the same
 * `typeNode`-driven cast rule the `columnRef` case already uses applies
 * to their result unchanged. `sum`/`avg` are deliberately excluded:
 * `convert.ts`'s own `PASSTHROUGH_AGGREGATES` never attempts to revive
 * them as a fixed type either (Postgres's own promotion table isn't
 * modeled there), so casting them to text here would be a lie the read
 * side never corrects — a value arriving as a string where a number was
 * promised, a regression this cast must not introduce (F6 task 6.2's own
 * measurement: they never manufacture a wrong *bigint* either way,
 * cast or not, so they carry no risk this cast exists to close).
 */
const isPassthroughAggregateCall = (expr: ExprNode): boolean => {
	const name = builderAggregateFunctionName(expr);
	return name === "min" || name === "max";
};

/** `true` for a direct `columnRef` or a passthrough aggregate — the two shapes {@link atRiskCastSuffix} resolves via `typeNode`, split out to keep that function's own branch count low (D71/#154 ratchet-5). */
const isColumnRefOrPassthroughAggregate = (expr: ExprNode): boolean => {
	if (expr.nodeKind === "columnRef") {
		return true;
	}
	return isPassthroughAggregateCall(expr);
};

/**
 * The `::text`/`::text[]` suffix `expr` needs to survive JSON transport
 * losslessly, or `null` when it doesn't need one — covers a direct
 * `columnRef` and the two aggregate shapes `convert.ts`'s own revive
 * logic tries to type as something more precise than "whatever JSON
 * says" (#444 F6): `count()` unconditionally, `min`/`max` via the same
 * `typeNode` lookup a bare column ref uses.
 */
const atRiskCastSuffix = (
	expr: ExprNode,
	inputValue: unknown,
): string | null => {
	if (isCountCall(expr)) {
		return "::text";
	}
	if (!isColumnRefOrPassthroughAggregate(expr)) {
		return null;
	}
	const typeNode = typeNodeOf(inputValue);
	if (typeNode === undefined) {
		return null;
	}
	return jsonSafeCastSuffix(typeNode);
};

const castColumnIfAtRisk = (
	column: {
		readonly alias: string;
		readonly resultKey?: string;
		readonly expr: ExprNode;
	},
	inputValue: unknown,
): {
	readonly alias: string;
	readonly resultKey?: string;
	readonly expr: ExprNode;
} => {
	const suffix = atRiskCastSuffix(column.expr, inputValue);
	if (suffix === null) {
		return column;
	}
	return { ...column, expr: castExprNode(column.expr, suffix) };
};

/**
 * Bakes the D102 cast+revive casts into an embedded subselect's
 * projection AT BUILD TIME — the node itself carries the casts, so the
 * compiled SQL, the snapshot codec round-trip, and rename retargeting
 * all see the same statement (a render-time cast could not: the stored
 * node has no column types). A direct column ref and the `count()`/
 * `min`/`max` aggregate shapes `convert.ts`'s own revive logic tries to
 * type precisely are cast (#444 F6); any other computed expression's
 * JSON shape is its author's own contract. The types come from the
 * chain's own `projectionInput` (the built refs — and, since #444 F9,
 * `min`/`max`'s own result — carry their `typeNode`); a whole-`Table`
 * subselect expands into the equivalent aliased projection so its casts
 * apply too (F2).
 */
/** Expands a whole-`Table` subselect into an explicit aliased projection with the F1 casts applied — the builder knows every column's type here (the table meta), so the most common nested-read form must not be the one that silently loses precision (F2 owner ruling at group 2 review). */
const expandTableProjection = (
	query: SelectNode,
	projectionInput: Table,
): SelectNode => {
	const meta = getTableMeta(projectionInput);
	const columns = meta.columns.map((column) => {
		const ref: ExprNode = {
			nodeKind: "columnRef",
			schemaName: meta.schema.schemaName,
			tableName: meta.tableName,
			columnName: column.columnName,
		};
		const suffix = jsonSafeCastSuffix(column.columnState.typeNode);
		if (suffix === null) {
			return {
				alias: column.columnName,
				resultKey: column.columnKey,
				expr: ref,
			};
		}
		return {
			alias: column.columnName,
			resultKey: column.columnKey,
			expr: castExprNode(ref, suffix),
		};
	});
	return {
		...query,
		projection: { projectionKind: "columns", columns },
	};
};

const withJsonSafeCasts = (
	query: SelectNode,
	projectionInput: SelectProjection,
): SelectNode => {
	if (isTable(projectionInput)) {
		return expandTableProjection(query, projectionInput);
	}
	if (query.projection.projectionKind !== "columns") {
		return query;
	}
	const originalColumns = query.projection.columns;
	const columns = originalColumns.map((column) =>
		castColumnIfAtRisk(
			column,
			inputValueFor(projectionInput, column.resultKey),
		),
	);
	const anyCast = columns.some(
		(column, index) => column !== originalColumns[index],
	);
	if (!anyCast) {
		return query;
	}
	return { ...query, projection: { ...query.projection, columns } };
};

/**
 * Phantom marker `jsonArrayFrom`/`jsonObjectFrom` stamp on their returned
 * expression (add-relational-reads group 3) — carries the embedded
 * subselect's projection TYPE and mode so the query layer can compute the
 * nested row type. Optional and never assigned at runtime (the
 * `columnMetaBrand` precedent).
 */
export const nestedReadBrand: unique symbol = Symbol("hejbro:nested-read");

/** The marker's shape — see {@link nestedReadBrand}. */
export type NestedReadMarker<
	TMode extends "jsonArray" | "jsonObject",
	TProjection extends SelectProjection,
> = {
	readonly [nestedReadBrand]?: {
		readonly mode: TMode;
		readonly projection: TProjection;
	};
};

const buildSelectExpr =
	<TMode extends "jsonArray" | "jsonObject">(mode: TMode) =>
	<TProjection extends SelectProjection>(
		subselect: SelectLimited<TProjection>,
	): Expr<"json"> & NestedReadMarker<TMode, TProjection> =>
		expr("json", {
			nodeKind: "selectExpr",
			mode,
			query: withJsonSafeCasts(
				subselect.selectQuery,
				subselect.projectionInput,
			),
		});

/** Wraps a subselect into a projection expression compiling to a correlated `(select coalesce(json_agg("agg"), '[]'::json) from (…) as "agg")` — the nested-collection primitive (D102). The subselect's `where`/`orderBy`/`limit` and its own nested reads carry through; empty arrives as `[]`, never SQL null. */
export const jsonArrayFrom = buildSelectExpr("jsonArray");
/** Wraps a subselect into a correlated `(select row_to_json("agg") from (…) as "agg")` — the single-nested-row primitive (D102). No row arrives as SQL null; more than one row is Postgres's own loud error (add `limit 1` with an order for a deterministic pick). */
export const jsonObjectFrom = buildSelectExpr("jsonObject");

const buildExists =
	(negated: boolean) =>
	(query: SelectLimited): Expr<"boolean"> =>
		expr("boolean", {
			nodeKind: "exists",
			negated,
			query: {
				...query.selectQuery,
				projection: { projectionKind: "constantOne" },
			},
		});

/** `exists (select 1 from … where …)` — replaces the subquery's projection with the `select 1` idiom regardless of what it selected. */
export const exists = buildExists(false);
/** `not exists (select 1 from … where …)` — see {@link exists}. */
export const notExists = buildExists(true);
