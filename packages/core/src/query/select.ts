import type { Table } from "../dsl/table";
import { getTableMeta, isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	Expr,
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

export type SelectLimited = { readonly selectQuery: SelectNode };
export type SelectOrdered = SelectLimited & {
	limit(count: number): SelectLimited;
};
export type SelectFiltered = SelectOrdered & {
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectOrdered;
};
export type SelectJoinable = SelectFiltered & {
	innerJoin(joined: Table, on: Expr<"boolean">): SelectJoinable;
	where(condition: Expr<"boolean">): SelectFiltered;
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

const makeStages = (query: SelectNode): SelectJoinable => ({
	selectQuery: query,
	innerJoin: (joined, on) =>
		makeStages({
			...query,
			joins: [
				...query.joins,
				{ joinKind: "inner", table: tableRefOf(joined), on: on.exprNode },
			],
		}),
	where: (condition) => makeStages({ ...query, where: condition.exprNode }),
	orderBy: (...terms) =>
		makeStages({ ...query, orderBy: terms.map(resolveOrderTerm) }),
	limit: (count) => {
		if (!Number.isInteger(count) || count < 0) {
			return throwHejbroError(
				"invalid-limit",
				`limit(${count}) must be a non-negative integer.`,
			);
		}
		return makeStages({ ...query, limit: count });
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
			"select() with an object projection can't infer the from table — pass it as the second argument: select({ … }, posts).",
		);
	}
	return {
		projectionNode: {
			projectionKind: "columns",
			columns: Object.entries(projection).map(([alias, value]) => ({
				alias: toSnakeCase(alias),
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
export const select = (
	projection: SelectProjection,
	from?: Table,
): SelectJoinable => {
	const { projectionNode, fromTable } = resolveProjection(projection, from);
	return makeStages({
		queryKind: "select",
		projection: projectionNode,
		from: tableRefOf(fromTable),
		joins: [],
		where: null,
		orderBy: [],
		limit: null,
	});
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
