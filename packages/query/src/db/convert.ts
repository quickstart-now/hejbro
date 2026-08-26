import type {
	ColumnState,
	ExprNode,
	ProjectionNode,
	QueryNode,
	ReturningNode,
	Table,
	TableRefNode,
} from "@hejbro/core";
import { getTableMeta } from "@hejbro/core";
import type { DriverRow } from "../driver/contract";
import { parseInterval } from "../types/interval";
import { convertNumericText } from "../types/numeric-mode";
import type { Declarations } from "./db";

/** One result column's resolved conversion state: the alias/key a driver row uses, and the declared `ColumnState` behind it -- `undefined` when no declared column backs this result column at all (a computed expression, or a table `execute()`'s caller never declared; owner review judgment 4's #311-aligned honest limitation, never filled in with a guess). */
export type ColumnPlanEntry = {
	readonly alias: string;
	readonly columnState: ColumnState | undefined;
};

const tableMatches = (
	table: Table,
	schemaName: string,
	tableName: string,
): boolean => {
	const meta = getTableMeta(table);
	return meta.schema.schemaName === schemaName && meta.tableName === tableName;
};

/**
 * The single resolver every conversion path uses (owner review judgment
 * 4, batch A/B correspondence): a whole-table select's `allColumns` list,
 * an object projection's `ColumnRefNode`, and a mutation's `returning()`
 * (via its `InsertNode`/`UpdateNode`/`DeleteNode.table`) all resolve a
 * declared column's runtime `ColumnState` through this one function,
 * given nothing but its SQL identity — never a shortcut that reads a
 * builder stage's own `fromTable`/`projectionInput` fields instead.
 * `undefined` when `tables` doesn't declare that table/column at all
 * (never thrown here — a caller decides what "no declared column" means:
 * {@link convertRow} treats it as "pass the raw value through").
 */
export const resolveColumnState = (
	tables: Declarations["tables"],
	schemaName: string,
	tableName: string,
	columnName: string,
): ColumnState | undefined => {
	const table = Object.values(tables).find((candidate) =>
		tableMatches(candidate, schemaName, tableName),
	);
	if (table === undefined) {
		return undefined;
	}
	const column = getTableMeta(table).columns.find(
		(candidate) => candidate.columnName === columnName,
	);
	return column?.columnState;
};

const columnStateForExpr = (
	expr: ExprNode,
	tables: Declarations["tables"],
): ColumnState | undefined => {
	if (expr.nodeKind !== "columnRef") {
		return undefined;
	}
	return resolveColumnState(
		tables,
		expr.schemaName,
		expr.tableName,
		expr.columnName,
	);
};

const columnPlanFromProjection = (
	projection: ProjectionNode,
	from: TableRefNode,
	tables: Declarations["tables"],
): ReadonlyArray<ColumnPlanEntry> => {
	if (projection.projectionKind === "allColumns") {
		return projection.columnNames.map((columnName) => ({
			alias: columnName,
			columnState: resolveColumnState(
				tables,
				from.schemaName,
				from.tableName,
				columnName,
			),
		}));
	}
	if (projection.projectionKind === "columns") {
		return projection.columns.map(({ alias, expr }) => ({
			alias,
			columnState: columnStateForExpr(expr, tables),
		}));
	}
	// "constantOne" -- the exists()/notExists() subquery projection; never
	// reaches execute() as a top-level statement, so there is no result
	// row to convert.
	return [];
};

const columnPlanFromReturning = (
	returning: ReturningNode,
	target: TableRefNode,
	tables: Declarations["tables"],
): ReadonlyArray<ColumnPlanEntry> => {
	if (returning.returningKind === "allColumns") {
		return returning.columnNames.map((columnName) => ({
			alias: columnName,
			columnState: resolveColumnState(
				tables,
				target.schemaName,
				target.tableName,
				columnName,
			),
		}));
	}
	return returning.columns.map(({ alias, expr }) => ({
		alias,
		columnState: columnStateForExpr(expr, tables),
	}));
};

/**
 * The ordered per-result-column plan for `node` — one entry per key a
 * driver row will actually carry, in the same order `compile()` rendered
 * them. A select's own projection, or a mutation's `returning()`; a
 * `returning`-less mutation has no result columns at all.
 */
export const columnPlanForResult = (
	node: QueryNode,
	tables: Declarations["tables"],
): ReadonlyArray<ColumnPlanEntry> => {
	if (node.queryKind === "select") {
		return columnPlanFromProjection(node.projection, node.from, tables);
	}
	if (node.returning === null) {
		return [];
	}
	return columnPlanFromReturning(node.returning, node.table, tables);
};

/** Builds and throws the `result-conversion-failed`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). */
function throwResultConversionFailed(column: string, cause: unknown): never {
	throw Object.assign(
		new Error(
			`column "${column}" failed to convert to its declared TypeScript type. Next: check the value came from the driver's own text for that column's declared type, unmodified by any client-side type parser.`,
		),
		{ code: "result-conversion-failed", column, cause },
	);
}

/**
 * The actual conversion for a cell whose declared column is already known
 * (`convertCell` has excluded `null`/no-`columnState` before this ever
 * runs) — only numeric mode and `interval` have a declared conversion at
 * this contract level (owner decision, task 4.4); every other declared
 * type is already the shape the driver hands back. Split out from
 * {@link convertCell} so each function's own branch count stays low
 * (CRAP ≤ 5).
 */
const convertDeclaredValue = (
	raw: unknown,
	columnState: ColumnState,
): unknown => {
	if (columnState.mode !== null) {
		return convertNumericText(String(raw), columnState.mode);
	}
	if (columnState.typeNode.typeName === "interval") {
		return parseInterval(String(raw));
	}
	return raw;
};

/**
 * Converts one raw driver cell per its resolved `columnState` — `null`
 * always passes through unconverted (a SQL `NULL` is never "the wrong
 * shape" to convert), and a column with no resolved state (a computed
 * expression, or a table `columnPlanForResult` couldn't resolve) passes
 * its raw value through unchanged, matching `SelectResult`'s own honest
 * widening (`select-result.ts`, #311) rather than guessing.
 */
const convertCell = (
	raw: unknown,
	columnState: ColumnState | undefined,
	column: string,
): unknown => {
	if (raw === null || columnState === undefined) {
		return raw;
	}
	try {
		return convertDeclaredValue(raw, columnState);
	} catch (cause) {
		return throwResultConversionFailed(column, cause);
	}
};

/** Converts every cell of one driver row per `plan` — the row-level entry point {@link convertRows} maps over. */
export const convertRow = (
	row: DriverRow,
	plan: ReadonlyArray<ColumnPlanEntry>,
): DriverRow =>
	Object.fromEntries(
		plan.map(({ alias, columnState }) => [
			alias,
			convertCell(row[alias], columnState, alias),
		]),
	);

/** Converts every row a driver returned, per the same `plan` (task 4.4). */
export const convertRows = (
	rows: ReadonlyArray<DriverRow>,
	plan: ReadonlyArray<ColumnPlanEntry>,
): ReadonlyArray<DriverRow> => rows.map((row) => convertRow(row, plan));
