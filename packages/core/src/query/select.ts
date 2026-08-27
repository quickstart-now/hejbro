import type { Table } from "../dsl/table";
import { getTableMeta, isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	Expr,
	JoinKind,
	OrderByTerm,
	ProjectionNode,
	SelectNode,
	TableRefNode,
} from "../expr/ast";
import { expr, isExpr } from "../expr/ast";

/** A `select()` projection: the whole table (deterministic column list), or an object of aliased expressions. */
export type SelectProjection = Table | Record<string, Expr>;

export type OrderTermInput =
	| Expr
	| { readonly by: Expr; readonly direction: "asc" | "desc" };

export type SelectLimited<
	TProjection extends SelectProjection = SelectProjection,
> = {
	readonly selectQuery: SelectNode;
	readonly fromTable: Table;
	readonly projectionInput: TProjection;
};
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
	innerJoin(joined: Table, on: Expr<"boolean">): SelectJoinable<TProjection>;
	leftJoin(joined: Table, on: Expr<"boolean">): SelectJoinable<TProjection>;
	where(condition: Expr<"boolean">): SelectFiltered<TProjection>;
};

const tableRefOf = (target: Table): TableRefNode => {
	const meta = getTableMeta(target);
	return { schemaName: meta.schema.schemaName, tableName: meta.tableName };
};

const resolveOrderTerm = (term: OrderTermInput): OrderByTerm => {
	if (isExpr(term)) {
		return { expr: term.exprNode, direction: "asc" };
	}
	return { expr: term.by.exprNode, direction: term.direction };
};

const appendJoin = (
	query: SelectNode,
	joinKind: JoinKind,
	joined: Table,
	on: Expr<"boolean">,
): SelectNode => ({
	...query,
	joins: [
		...query.joins,
		{ joinKind, table: tableRefOf(joined), on: on.exprNode },
	],
});

const makeStages = <TProjection extends SelectProjection>(
	query: SelectNode,
	fromTable: Table,
	projectionInput: TProjection,
): SelectJoinable<TProjection> => ({
	selectQuery: query,
	fromTable,
	projectionInput,
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
