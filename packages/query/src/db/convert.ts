import type {
	ColumnState,
	ExprNode,
	ProjectionNode,
	QueryNode,
	ReturningNode,
	SqlTemplateChunk,
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

/** One result column's resolved conversion state: `alias` is the key the DRIVER's row uses (the SQL column name, or a projection's rendered alias), `resultKey` is the key the CONVERTED row carries -- the declared TS column key the inferred row type promises (#339; identical to `alias` except on an unaliased declared column whose TS key snake_cases differently), and `columnState` is the declared state behind it -- `undefined` when no declared column backs this result column at all (a computed expression, or a table `execute()`'s caller never declared; owner review judgment 4's #311-aligned honest limitation, never filled in with a guess). */
export type ColumnPlanEntry = {
	readonly alias: string;
	readonly resultKey: string;
	readonly columnState: ColumnState | undefined;
	/**
	 * Present when this cell is a nested read (a `selectExpr` projection,
	 * D102 task 3.4): the child rows' own plan, built recursively — so
	 * grandchildren revive for free — plus the arrival mode. The cell's
	 * own `columnState` stays `undefined` (there is no declared column
	 * for the aggregate itself).
	 */
	readonly nested?: {
		readonly mode: "jsonArray" | "jsonObject";
		readonly entries: ReadonlyArray<ColumnPlanEntry>;
	};
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
): ColumnState | undefined =>
	findColumnEntry(tables, schemaName, tableName, columnName)?.columnState;

/**
 * The full declared column entry behind a SQL identity — `columnKey` (the
 * declared TS key, #339's `resultKey` source) alongside the
 * `columnState` {@link resolveColumnState} narrows this down to. Same
 * lookup, one function behind both.
 */
const findColumnEntry = (
	tables: Declarations["tables"],
	schemaName: string,
	tableName: string,
	columnName: string,
) => {
	const table = findTable(tables, schemaName, tableName);
	if (table === undefined) {
		return undefined;
	}
	return getTableMeta(table).columns.find(
		(candidate) => candidate.columnName === columnName,
	);
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

/**
 * One `allColumns` plan entry — shared by the projection and returning
 * paths (both derive from the same declared-table lookup): the driver
 * row's key is the SQL `columnName`, the converted row's key is the
 * declared `columnKey` (#339), and an undeclared table falls back to the
 * SQL name with no conversion, `resolveColumnState`'s own honest
 * limitation. Split out per the D71/#154 ratchet-5 discipline.
 */
const allColumnsPlanEntry = (
	tables: Declarations["tables"],
	ref: TableRefNode,
	columnName: string,
): ColumnPlanEntry => {
	const column = findColumnEntry(
		tables,
		ref.schemaName,
		ref.tableName,
		columnName,
	);
	return {
		alias: columnName,
		resultKey: column?.columnKey ?? columnName,
		columnState: column?.columnState,
	};
};

/** One object-projection column's plan entry — a `selectExpr` cell gets its recursive nested plan, everything else resolves its (cast-unwrapped) declared state. */
const projectionPlanEntry = (
	column: {
		readonly alias: string;
		readonly resultKey?: string;
		readonly expr: ExprNode;
	},
	tables: Declarations["tables"],
): ColumnPlanEntry => {
	const { alias, resultKey, expr } = column;
	if (expr.nodeKind === "selectExpr") {
		return {
			alias,
			resultKey: resultKey ?? alias,
			columnState: undefined,
			nested: {
				mode: expr.mode,
				entries: columnPlanFromProjection(
					expr.query.projection,
					expr.query.from,
					tables,
				),
			},
		};
	}
	return {
		alias,
		resultKey: resultKey ?? alias,
		columnState: columnStateForExpr(uncast(expr), tables),
	};
};

const columnPlanFromProjection = (
	projection: ProjectionNode,
	from: TableRefNode,
	tables: Declarations["tables"],
): ReadonlyArray<ColumnPlanEntry> => {
	if (projection.projectionKind === "allColumns") {
		return projection.columnNames.map((columnName) =>
			allColumnsPlanEntry(tables, from, columnName),
		);
	}
	if (projection.projectionKind === "columns") {
		// `resultKey` is the caller's verbatim projection key (#339); a node
		// without one (hand-built, or codec-decoded -- stored view queries)
		// falls back to the rendered alias, the pre-#339 behavior.
		return projection.columns.map((column) =>
			projectionPlanEntry(column, tables),
		);
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
		return returning.columnNames.map((columnName) =>
			allColumnsPlanEntry(tables, target, columnName),
		);
	}
	return returning.columns.map(({ alias, resultKey, expr }) => ({
		alias,
		resultKey: resultKey ?? alias,
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
	if (node.queryKind === "setOp") {
		// a set-op's rows convert per the LEFT branch (D103 -- SQL's own
		// naming rule; the leftmost select is what names the output).
		return columnPlanForResult(node.left, tables);
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

/** Builds the `unexpected-array-arrival-shape`-coded, enriched plain `Error` {@link rawArrayElements} throws (D3's kebab-case-code convention for `@hejbro/query`, matching `interval.ts`'s `throwUnparsableInterval`/`array-text.ts`'s `throwUnparsableArrayText`) — the arrival shape a declared array element contracts for (`expectedShape`) didn't match what the driver actually handed back (`typeof raw`). Named separately from a plain `Error` (planner review, batch A rework) so a test can assert `cause.code` and tell "the declared-type guard fired" apart from an incidental `TypeError` a missing guard would otherwise let through unnoticed. */
const throwUnexpectedArrayArrivalShape = (
	expectedShape: "raw array-literal text" | "a JS array",
	elementTypeName: string,
	raw: unknown,
): never => {
	throw Object.assign(
		new Error(
			`expected ${expectedShape} for an array column whose element type is ${JSON.stringify(elementTypeName)}, got ${typeof raw}. Next: check the driver delegates this array oid the way the declared element type contracts (task 1.3's driver-contract delta) — never coerced or guessed at here.`,
		),
		{ code: "unexpected-array-arrival-shape" },
	);
};

/**
 * Declared element types whose array column is contracted to arrive as
 * raw Postgres array-literal text, never `pg`'s own default array
 * parsing — `interval` (task 1.3's driver override, oid 1187) and
 * `numeric` (task B2.1's driver override, oid 1231) each have their own
 * driver-level override for exactly this reason (both would otherwise
 * arrive already lossily parsed: `PostgresInterval` objects and
 * `parseFloat`'d numbers, respectively — the postgres:17 integration
 * proof, task 1.5, is what surfaced the `numeric` case). Every other
 * declared element type (`bigint` included — oid 1016's own default
 * array parser already returns text elements, no override needed) keeps
 * `pg`'s own default array parsing, contracted to already be a JS array.
 */
const RAW_ARRAY_TEXT_ELEMENT_TYPE_NAMES: ReadonlyArray<TypeNode["typeName"]> = [
	"interval",
	"numeric",
];

/** `true` when `element`'s array column is contracted to arrive as raw array-literal text — see {@link RAW_ARRAY_TEXT_ELEMENT_TYPE_NAMES}. */
const expectsRawArrayText = (element: TypeNode): boolean =>
	RAW_ARRAY_TEXT_ELEMENT_TYPE_NAMES.includes(element.typeName);

/** `raw`'s own element list when `element` is contracted to arrive as raw array-literal text (see {@link expectsRawArrayText}) — parsed via {@link parseArrayText}. A `raw` that isn't a string at all doesn't match that contract and is never coerced or guessed at: {@link throwUnexpectedArrayArrivalShape} throws instead. */
const rawArrayElementsFromText = (
	raw: unknown,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	if (typeof raw !== "string") {
		return throwUnexpectedArrayArrivalShape(
			"raw array-literal text",
			element.typeName,
			raw,
		);
	}
	return parseArrayText(raw);
};

/** `raw`'s own element list when `element` keeps `pg`'s own default array parsing (every declared element type {@link expectsRawArrayText} answers `false` for) — `raw` itself, unchanged. A `raw` that isn't already a JS array doesn't match that contract: {@link throwUnexpectedArrayArrivalShape} throws instead of coercing or guessing. */
const rawArrayElementsFromJsArray = (
	raw: unknown,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	if (!Array.isArray(raw)) {
		return throwUnexpectedArrayArrivalShape(
			"a JS array",
			element.typeName,
			raw,
		);
	}
	return raw;
};

/**
 * `raw`'s own element list — the arrival shape is decided by `element`
 * (the array's declared element {@link TypeNode}), **never** by sniffing
 * `raw`'s own runtime type: the driver-contract delta fixes exactly which
 * declared element types arrive as raw array-literal text
 * ({@link expectsRawArrayText}) versus `pg`'s own default array parsing,
 * and this mirrors that contract rather than guessing from whatever
 * happened to show up.
 *
 * Handoff note (future drivers): both branches here are `@hejbro/pg`-
 * specific facts, not a law of nature — a future driver (a PostgREST-
 * style HTTP driver, say) could reasonably hand back a different arrival
 * shape for the same declared element type. If that happens, the fix is
 * to widen the driver contract to name that driver's own shape
 * explicitly (and branch on which driver produced the row, the same way
 * {@link expectsRawArrayText} branches on the declared element type
 * today) — never to fall back to sniffing `raw`'s runtime type again,
 * which is exactly the anti-pattern this file's own history (planner
 * review, batch A rework) already replaced once.
 */
const rawArrayElements = (
	raw: unknown,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	if (expectsRawArrayText(element)) {
		return rawArrayElementsFromText(raw, element);
	}
	return rawArrayElementsFromJsArray(raw, element);
};

/**
 * Converts one array element against `elementState` (the array column's
 * `columnState` with `typeNode` swapped for its declared element type,
 * `mode` carried through unchanged) — `null` (an unquoted `NULL` element,
 * or the moded-array driver's own `null`) passes through unconverted, the
 * same rule {@link convertCell} applies at the cell level, UNLESS the array
 * column is declared `.notNullElements()`: the spread in
 * {@link convertArrayValue} carries `columnState.notNullElements` into
 * `elementState` unchanged, so a `NULL` element arriving under that flag
 * means the backing CHECK no longer holds (dropped or bypassed
 * out-of-band, design decision 4) — this throws a plain `Error` (no new
 * error code; {@link convertCell}'s own try/catch wraps it into the
 * existing `result-conversion-failed` family via
 * {@link throwResultConversionFailed}, which is the whole contract) rather
 * than silently returning `null` typed as the bare, non-null element type.
 * Reuses {@link convertDeclaredValue} for the non-null path rather than
 * duplicating the mode/interval branches, so element and top-level scalar
 * conversion can never disagree.
 */
const convertArrayElement = (
	raw: unknown,
	elementState: ColumnState,
): unknown => {
	if (raw === null) {
		if (elementState.notNullElements === true) {
			throw new Error(
				"array element is null, but this column is declared .notNullElements(). Next: check the backing CHECK wasn't dropped or bypassed out-of-band -- a NULL element here means the constraint no longer holds.",
			);
		}
		return null;
	}
	return convertDeclaredValue(raw, elementState);
};

/**
 * Converts an array column's cell element-wise against `element` (its
 * declared element {@link TypeNode}). Multi-dimensional array *text*
 * parsing is out of scope (design.md Non-Goals) — but `element` can still
 * literally be `"array"` at the type level (`.array().array()` is
 * expressible via the DSL); this function doesn't special-case that away.
 * It would simply recurse into {@link convertArrayElement}/
 * {@link convertDeclaredValue} again, and {@link rawArrayElements}'s own
 * arrival-shape guard would need a plausible shape for that nested
 * element too (never coerced or guessed at) — an untested, unsupported
 * path, not one this function actively rejects. A single poisoned element
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
/**
 * Sees through the F1 cast wrapper (`sqlTemplate` of exactly
 * `[columnRef, "::text" | "::text[]"]`, baked by `jsonArrayFrom`/
 * `jsonObjectFrom` at build time) so a cast column still resolves its
 * declared state — without this, exactly the columns the cast protects
 * (bigint/numeric) would arrive as unrevived text.
 */
const isCastSuffixChunk = (chunk: SqlTemplateChunk | undefined): boolean =>
	chunk?.chunkKind === "text" &&
	(chunk.text === "::text" || chunk.text === "::text[]");

const castInnerRef = (
	chunk: SqlTemplateChunk | undefined,
): ExprNode | undefined => {
	if (chunk?.chunkKind === "expr" && chunk.expr.nodeKind === "columnRef") {
		return chunk.expr;
	}
	return undefined;
};

/** The two-chunk `[ref, suffix]` inner ref, else `undefined` — only `jsonArrayFrom`/`jsonObjectFrom`'s own cast builder produces this exact shape (a `sql\`\`` template always leads with a text chunk), so the suffix check is a cheap shape confirmation, not a reachable DSL path. */
const castInnerRefIfSuffixed = (
	first: SqlTemplateChunk | undefined,
	second: SqlTemplateChunk | undefined,
): ExprNode | undefined => {
	if (!isCastSuffixChunk(second)) {
		return undefined;
	}
	return castInnerRef(first);
};

const castTarget = (expr: ExprNode): ExprNode | undefined => {
	if (expr.nodeKind !== "sqlTemplate" || expr.chunks.length !== 2) {
		return undefined;
	}
	return castInnerRefIfSuffixed(expr.chunks[0], expr.chunks[1]);
};

const uncast = (expr: ExprNode): ExprNode => castTarget(expr) ?? expr;

const stripHexPrefix = (raw: string): string => {
	if (raw.startsWith("\\x")) {
		return raw.slice(2);
	}
	return raw;
};

/** `"\\x0102ff"` (the driver-pinned hex form) → bytes — pure, no Buffer dependency (the declared read type is `Uint8Array`). */
const hexToBytes = (raw: string): Uint8Array => {
	const hex = stripHexPrefix(raw);
	const pairs = hex.match(/.{2}/g) ?? [];
	return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
};

const JSON_DATETIME_TYPE_NAMES: ReadonlySet<string> = new Set([
	"timestamp",
	"timestamptz",
]);

/**
 * `"YYYY-MM-DD"` → LOCAL midnight, matching what the driver's own parser
 * gives a top-level `date` read (g3 review F1, real-server measured):
 * `new Date("YYYY-MM-DD")` is UTC midnight per the ES spec, which lands
 * the value on the PREVIOUS calendar day in any negative-offset zone —
 * the same column must never read a different instant nested vs
 * top-level. Appending `T00:00:00` (no zone) makes the parse local.
 */
const parseLocalDate = (raw: string): Date => {
	const parsed = new Date(`${raw}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`"${raw}" is not a YYYY-MM-DD date value`);
	}
	return parsed;
};

const parseNestedTimestamp = (raw: string): Date => {
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`"${raw}" is not an ISO-8601 datetime value`);
	}
	return parsed;
};

/**
 * Revives one nested SCALAR from its JSON arrival shape (D102 F1
 * contract): datetimes arrive as ISO-8601 strings (a top-level read gets
 * a `Date` from the driver's own parser, which never sees this value),
 * `bytea` as the pinned hex form — everything else arrives in the same
 * shape the driver hands a top-level cell, so the ordinary declared
 * conversion applies unchanged.
 */
const reviveNestedArray = (
	raw: unknown,
	columnState: ColumnState,
	element: TypeNode,
): ReadonlyArray<unknown> => {
	const elementState: ColumnState = { ...columnState, typeNode: element };
	return (raw as ReadonlyArray<unknown>).map((entry) => {
		if (entry === null) {
			return null;
		}
		return reviveNestedScalar(entry, elementState);
	});
};

const reviveNestedScalar = (
	raw: unknown,
	columnState: ColumnState,
): unknown => {
	const typeNode = columnState.typeNode;
	if (JSON_DATETIME_TYPE_NAMES.has(typeNode.typeName)) {
		return parseNestedTimestamp(String(raw));
	}
	if (typeNode.typeName === "date") {
		return parseLocalDate(String(raw));
	}
	if (typeNode.typeName === "bytea") {
		return hexToBytes(String(raw));
	}
	if (typeNode.typeName === "array") {
		return reviveNestedArray(raw, columnState, typeNode.element);
	}
	return convertDeclaredValue(raw, columnState);
};

/** Revives one nested child row through its own plan (recursing into grandchildren via {@link convertNestedCell}). */
const reviveNestedRow = (
	raw: Record<string, unknown>,
	entries: ReadonlyArray<ColumnPlanEntry>,
): Record<string, unknown> =>
	Object.fromEntries(
		entries.map((entry) => [entry.resultKey, convertNestedCell(raw, entry)]),
	);

const convertNestedCell = (
	raw: Record<string, unknown>,
	entry: ColumnPlanEntry,
): unknown => {
	const value = raw[entry.alias];
	if (entry.nested !== undefined) {
		return reviveNestedContainer(value, entry.nested);
	}
	if (entry.columnState === undefined) {
		return value;
	}
	return reviveNestedScalarOrThrow(value, entry.columnState, entry.alias);
};

/** `null`/missing pass straight through (a SQL NULL is never the wrong shape); everything else revives or fails loudly. */
const reviveNestedScalarOrThrow = (
	value: unknown,
	columnState: ColumnState,
	alias: string,
): unknown => {
	if (value === null || value === undefined) {
		return value;
	}
	try {
		return reviveNestedScalar(value, columnState);
	} catch (cause) {
		return throwResultConversionFailed(alias, cause);
	}
};

/** The container step: a collection maps every child row, a single read is `Row | null`. */
const reviveNestedContainer = (
	value: unknown,
	nested: NonNullable<ColumnPlanEntry["nested"]>,
): unknown => {
	if (nested.mode === "jsonArray") {
		return (value as ReadonlyArray<Record<string, unknown>>).map((child) =>
			reviveNestedRow(child, nested.entries),
		);
	}
	if (value === null) {
		return null;
	}
	return reviveNestedRow(value as Record<string, unknown>, nested.entries);
};

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
	if (entry.nested !== undefined) {
		return reviveNestedContainer(row[entry.alias], entry.nested);
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
		plan.map((entry) => [entry.resultKey, convertPlannedCell(row, entry)]),
	);
};

/** Converts every row a driver returned, per the same `plan` (task 4.4). */
export const convertRows = (
	rows: ReadonlyArray<DriverRow>,
	plan: ReadonlyArray<ColumnPlanEntry>,
): ReadonlyArray<DriverRow> => rows.map((row) => convertRow(row, plan));
