import type { Table } from "../dsl/table";
import { getTableMeta, isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	Condition,
	Expr,
	ExprNode,
	JoinKind,
	OrderByTerm,
	ProjectionNode,
	SelectNode,
	SetOpNode,
	TableRefNode,
} from "../expr/ast";
import { expr, isExpr } from "../expr/ast";
import type { TypeNode } from "../types/type-node";

/** A `select()` projection: the whole table (deterministic column list), or an object of aliased expressions. */
export type SelectProjection = Table | Record<string, Expr>;

export type OrderTermInput =
	| Expr
	| { readonly by: Expr; readonly direction: "asc" | "desc" };

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
export type SelectOrdered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection> & {
	limit(count: number): SelectLimited<TProjection>;
};
export type SelectFiltered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectOrdered<TProjection> & {
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectOrdered<TProjection>;
};
export type SelectJoinable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectFiltered<TProjection> & {
	innerJoin(joined: Table, on: Condition): SelectJoinable<TProjection>;
	leftJoin(joined: Table, on: Condition): SelectJoinable<TProjection>;
	where(condition: Condition): SelectFiltered<TProjection>;
};

const tableRefOf = (target: Table): TableRefNode => {
	const meta = getTableMeta(target);
	return { schemaName: meta.schema.schemaName, tableName: meta.tableName };
};

/** Exported for `@hejbro/query`'s chain set-op stage (add-set-operations) — the one shared order-term resolver, never a second copy. */
export const resolveOrderTerm = (term: OrderTermInput): OrderByTerm => {
	if (isExpr(term)) {
		return { expr: term.exprNode, direction: "asc" };
	}
	return { expr: term.by.exprNode, direction: term.direction };
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

const makeStages = <TProjection extends SelectProjection>(
	query: SelectNode,
	fromTable: Table,
	projectionInput: TProjection,
): SelectJoinable<TProjection> => ({
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
	where: (condition) =>
		makeStages(
			{ ...query, where: condition.exprNode },
			fromTable,
			projectionInput,
		),
	orderBy: (...terms) =>
		makeStages(
			{ ...query, orderBy: terms.map(resolveOrderTerm) },
			fromTable,
			projectionInput,
		),
	limit: (count) => {
		if (!Number.isInteger(count) || count < 0) {
			return throwHejbroError(
				"invalid-limit",
				`limit(${count}) must be a non-negative integer. Next: pass a non-negative integer, e.g. limit(10).`,
			);
		}
		return makeStages({ ...query, limit: count }, fromTable, projectionInput);
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
): SelectJoinable<TProjection> => {
	const { projectionNode, fromTable } = resolveProjection(projection, from);
	return makeStages(
		{
			queryKind: "select",
			projection: projectionNode,
			from: tableRefOf(fromTable),
			joins: [],
			where: null,
			orderBy: [],
			limit: null,
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
	if (column.expr.nodeKind !== "columnRef") {
		return column;
	}
	const typeNode = (inputValue as { readonly typeNode?: TypeNode } | undefined)
		?.typeNode;
	if (typeNode === undefined) {
		return column;
	}
	const suffix = jsonSafeCastSuffix(typeNode);
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
 * node has no column types). Only direct column refs are cast — a
 * computed expression's JSON shape is its author's own contract. The
 * types come from the chain's own `projectionInput` (the built refs
 * carry their `typeNode`); a whole-`Table` subselect expands into the
 * equivalent aliased projection so its casts apply too (F2).
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
