import type {
	ColumnState,
	ExprNode,
	ProjectionNode,
	QueryNode,
	ReturningNode,
	Table,
	TableRefNode,
	TypeNode,
} from "@hejbro/core";
import { getTableMeta } from "@hejbro/core";
import type { CompileInput } from "../compile/compile";
import type { DriverRow } from "../driver/contract";
import { parseArrayText } from "../types/array-text";
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
 * Finds the declared {@link Table} identified by `(schemaName, tableName)`
 * in `tables` — the same SQL-identity lookup {@link resolveColumnState}
 * uses internally, exported so `fn.ts` (task 4.9, a returns-table
 * function call) can resolve a target table's full column list without
 * a second, disagreeing search.
 */
export const findTable = (
	tables: Declarations["tables"],
	schemaName: string,
	tableName: string,
): Table | undefined =>
	Object.values(tables).find((candidate) =>
		tableMatches(candidate, schemaName, tableName),
	);

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
	const table = findTable(tables, schemaName, tableName);
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

/** Distributes `T` over its own union members before taking `keyof` — plain `keyof (A | B)` is the *intersection* of `A`/`B`'s keys (only a key valid on every member), not their union; this is what actually produces "every key any member carries". */
type DistributedKeys<T> = T extends unknown ? keyof T : never;

/**
 * The exact key union `CompileInput`'s four `*Query` wrapper members
 * carry — derived from `CompileInput` itself (never copied by hand), so
 * a fifth wrapper key added to `compile.ts`'s own `CompileInput` shows up
 * here as a `tsc` error instead of a silent runtime miss (the same
 * exhaustive-record discipline task 4.1 applied to `DriverCapabilities`).
 * `compile/**` is out of this group's file scope, so `compile.ts`'s own
 * private `wrapperKeys` array can't be shared directly — binding to its
 * *type* (via the already-public `CompileInput`) is what's shared here.
 */
type CompileInputWrapperKey = DistributedKeys<
	Exclude<CompileInput, QueryNode | { readonly statementExpr: ExprNode }>
>;

/**
 * Exhaustive per {@link CompileInputWrapperKey} — a key missing here (or
 * an excess one) is a `tsc` error at this very object literal, not a
 * silently-stale runtime array `queryNodeOf` would search against.
 */
const wrapperKeyPresence: Record<CompileInputWrapperKey, true> = {
	selectQuery: true,
	insertQuery: true,
	updateQuery: true,
	deleteQuery: true,
};

const compileInputWrapperKeys = Object.keys(
	wrapperKeyPresence,
) as ReadonlyArray<CompileInputWrapperKey>;

/**
 * Extracts the {@link QueryNode} a {@link CompileInput} carries, for
 * column-plan resolution only — a minimal, single-purpose unwrap, never
 * a copy of `compile.ts`'s own private `unwrapQueryNode` (out of this
 * group's file scope, and a different job besides: that one feeds
 * rendering, this one feeds declaration lookup — keeping one
 * un-duplicated form here is what stops the two purposes from quietly
 * drifting apart into two disagreeing unwraps). The `sql` escape hatch
 * (`statementExpr`) has no declared column behind it at all — `undefined`,
 * not a node with zero columns.
 */
const queryNodeOf = (statement: CompileInput): QueryNode | undefined => {
	if ("statementExpr" in statement) {
		return undefined;
	}
	const wrapperKey = compileInputWrapperKeys.find((key) => key in statement);
	if (wrapperKey === undefined) {
		return statement as QueryNode;
	}
	return (statement as Record<CompileInputWrapperKey, QueryNode>)[wrapperKey];
};

/**
 * The per-result-column plan for `statement` exactly as `execute()`
 * received it (task 4.4-wiring) — resolves {@link queryNodeOf}`(statement)`
 * through {@link columnPlanForResult}, or an empty plan for the `sql`
 * escape hatch. An empty plan means "pass every row through unchanged"
 * ({@link convertRow}'s own contract), never "this row has zero columns".
 */
export const columnPlanForStatement = (
	statement: CompileInput,
	tables: Declarations["tables"],
): ReadonlyArray<ColumnPlanEntry> => {
	const node = queryNodeOf(statement);
	if (node === undefined) {
		return [];
	}
	return columnPlanForResult(node, tables);
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
 * `raw`'s own element list — the arrival shape is decided by `element`
 * (the array's declared element {@link TypeNode}), **never** by sniffing
 * `raw`'s own runtime type: the driver-contract delta fixes exactly one
 * declared type at one arrival shape apiece, and this mirrors that
 * contract rather than guessing from whatever happened to show up.
 * `interval[]` (task 1.3's driver override, oid 1187) is the one declared
 * element type contracted to arrive as raw Postgres array-literal text —
 * parsed here via {@link parseArrayText}. Every other declared element
 * type (moded numeric/bigint, or no runtime conversion at all) keeps
 * `pg`'s own default array parsing, contracted to already be a JS array.
 * A `raw` that doesn't match the shape its declared element contracts is
 * never coerced or guessed at — it throws, caught by {@link convertCell}'s
 * existing wrapper the same as any other conversion failure.
 */
const rawArrayElements = (
	raw: unknown,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	if (element.typeName === "interval") {
		if (typeof raw !== "string") {
			throw new Error(
				`expected the driver's raw array-literal text for an interval[] column (task 1.3's driver override), got ${typeof raw}.`,
			);
		}
		return parseArrayText(raw);
	}
	if (!Array.isArray(raw)) {
		throw new Error(
			`expected a JS array for this array column (pg's own default array parsing), got ${typeof raw}.`,
		);
	}
	return raw;
};

/**
 * Converts one array element against `elementState` (the array column's
 * `columnState` with `typeNode` swapped for its declared element type,
 * `mode` carried through unchanged) — `null` (an unquoted `NULL` element,
 * or the moded-array driver's own `null`) passes through unconverted, the
 * same rule {@link convertCell} applies at the cell level. Reuses
 * {@link convertDeclaredValue} rather than duplicating the mode/interval
 * branches, so element and top-level scalar conversion can never disagree.
 */
const convertArrayElement = (
	raw: unknown,
	elementState: ColumnState,
): unknown => {
	if (raw === null) {
		return null;
	}
	return convertDeclaredValue(raw, elementState);
};

/**
 * Converts an array column's cell element-wise against `element` (its
 * declared element {@link TypeNode}) — one level of nesting only (design.md
 * Non-Goals: multi-dimensional array text is out of scope, so `element`
 * itself is never `"array"` here in practice). A single poisoned element
 * fails the whole array via {@link convertArrayElement}'s reuse of
 * {@link convertDeclaredValue}'s own throwing branches; there is no partial
 * result.
 */
const convertArrayValue = (
	raw: unknown,
	columnState: ColumnState,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	const elementState: ColumnState = { ...columnState, typeNode: element };
	return rawArrayElements(raw, element).map((rawElement) =>
		convertArrayElement(rawElement, elementState),
	);
};

/**
 * The actual conversion for a cell whose declared column is already known
 * (`convertCell` has excluded `null`/no-`columnState` before this ever
 * runs) — array columns route element-wise through
 * {@link convertArrayValue}; otherwise only numeric mode and `interval`
 * have a declared conversion at this contract level (owner decision, task
 * 4.4); every other declared type is already the shape the driver hands
 * back. Split out from {@link convertCell} so each function's own branch
 * count stays low (CRAP ≤ 5). The array check comes first: an array
 * column's own `mode` (e.g. `bigint({mode:'bigint'}).array()`) describes
 * its *elements*, not the array value itself, so mode can never be checked
 * before typeName here.
 */
const convertDeclaredValue = (
	raw: unknown,
	columnState: ColumnState,
): unknown => {
	if (columnState.typeNode.typeName === "array") {
		return convertArrayValue(raw, columnState, columnState.typeNode.element);
	}
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

/**
 * Converts every cell of one driver row per `plan` — the row-level entry
 * point {@link convertRows} maps over. An **empty** `plan` passes `row`
 * through completely unchanged (task 4.4-wiring: the `sql` escape hatch
 * has no declared columns to resolve a plan against at all — an empty
 * plan means "nothing to convert", never "rebuild this row with zero
 * keys").
 */
/**
 * `convertRow`'s per-entry step: fails fast with `result-conversion-failed`
 * when `entry` names a *declared* column (`columnState !== undefined`)
 * that the driver's row is missing entirely (planner review, batch B
 * PASS follow-up 2) — silently reading it as `undefined` would let
 * `SelectResult`'s promised type (e.g. a `notNull` column typed
 * `string`) lie about a value that was never there, the same class of
 * bug 4.4-wiring fixed for "the conversion pipeline never ran at all".
 * The opposite direction — a raw row key with no matching plan entry —
 * is deliberately left alone: `convertRow` only ever emits the declared
 * shape, so an extra driver-side key is dropped, not an error.
 */
const convertPlannedCell = (
	row: DriverRow,
	entry: ColumnPlanEntry,
): unknown => {
	if (entry.columnState !== undefined && !(entry.alias in row)) {
		return throwResultConversionFailed(
			entry.alias,
			new Error(
				`the driver's row never included a "${entry.alias}" key at all. Next: check the statement actually selects/returns this column, and that the driver isn't silently dropping columns it doesn't recognize.`,
			),
		);
	}
	return convertCell(row[entry.alias], entry.columnState, entry.alias);
};

/**
 * Converts every cell of one driver row per `plan` — the row-level entry
 * point {@link convertRows} maps over. An **empty** `plan` passes `row`
 * through completely unchanged (task 4.4-wiring: the `sql` escape hatch
 * has no declared columns to resolve a plan against at all — an empty
 * plan means "nothing to convert", never "rebuild this row with zero
 * keys").
 */
export const convertRow = (
	row: DriverRow,
	plan: ReadonlyArray<ColumnPlanEntry>,
): DriverRow => {
	if (plan.length === 0) {
		return row;
	}
	return Object.fromEntries(
		plan.map((entry) => [entry.alias, convertPlannedCell(row, entry)]),
	);
};

/** Converts every row a driver returned, per the same `plan` (task 4.4). */
export const convertRows = (
	rows: ReadonlyArray<DriverRow>,
	plan: ReadonlyArray<ColumnPlanEntry>,
): ReadonlyArray<DriverRow> => rows.map((row) => convertRow(row, plan));
