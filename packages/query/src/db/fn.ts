import type {
	ColumnState,
	FunctionDeclaration,
	NumericMode,
	Table,
	TypeNode,
} from "@hejbro/core";
import { getTableMeta, qualifyName, quoteIdentifier } from "@hejbro/core";
import type { CompileResult } from "../compile/compile";
import type { DriverRow, DriverSession } from "../driver/contract";
import type { ColumnPlanEntry } from "./convert";
import { convertRows, findTable } from "./convert";
import type { Declarations } from "./db";
import { sendCompiled } from "./execute";

/** Builds and throws the `function-argument-count-mismatch`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). */
function throwArgumentCountMismatch(
	functionName: string,
	expected: number,
	actual: number,
): never {
	throw Object.assign(
		new Error(
			`db.fn call to "${functionName}" was given ${actual} argument(s), but it declares ${expected}. Next: pass exactly ${expected} value(s), in the function's declared argument order.`,
		),
		{ code: "function-argument-count-mismatch", expected, actual },
	);
}

/** Builds and throws the `function-return-kind-unsupported`-coded, enriched plain `Error` (D57) — a `function` declaration. `defineTrigger`'s own function declarations return `"trigger"` and are never meant to be called directly through SQL (Postgres attaches them via `CREATE TRIGGER`). */
function throwUnsupportedReturnKind(functionName: string): never {
	throw Object.assign(
		new Error(
			`db.fn can't call "${functionName}" directly -- it returns a trigger row, which Postgres only ever invokes by attaching the function to a table trigger. Next: don't call this one through db.fn.`,
		),
		{ code: "function-return-kind-unsupported" },
	);
}

const paramPlaceholders = (count: number): string =>
	Array.from({ length: count }, (_entry, index) => `$${index + 1}`).join(", ");

/** The explicit `select <columns> from <fn>(...)` plan for a `setofTable`-returning function — never `select *` (owner decision, task 4.9): the target table's own declared column order becomes both the rendered SQL column list and the conversion plan, so a returns-table call gets exactly the same numeric-mode/`interval` conversion a whole-table `select()` would. */
const setofTableCall = (
	declaration: FunctionDeclaration,
	table: Table,
	placeholders: string,
): {
	readonly compiled: CompileResult;
	readonly plan: ReadonlyArray<ColumnPlanEntry>;
} => {
	const columns = getTableMeta(table).columns;
	const columnList = columns
		.map((column) => quoteIdentifier(column.columnName))
		.join(", ");
	const ref = qualifyName(declaration.schemaName, declaration.functionName);
	return {
		compiled: {
			sql: `select ${columnList} from ${ref}(${placeholders})`,
			params: [],
			kind: "sql",
		},
		plan: columns.map((column) => ({
			alias: column.columnName,
			columnState: column.columnState,
		})),
	};
};

/**
 * Mirrors `ts-type-map.ts`'s own hand-spelled "no mode" defaults
 * (`bigint` type -> `'bigint'` mode, `numeric` type -> `'string'` mode,
 * tracked to unify at #310) — a `defineFunction({returns: <TypeNode>})`
 * scalar return has no column declaration to carry an explicit
 * `bigint({mode})`/`numeric({mode})` choice, so this fills exactly the
 * same default the type-level `BaseTsType` mapping already assumes when
 * `TMeta.mode` is absent, keeping the runtime conversion and the
 * compile-time type in agreement.
 */
const defaultNumericMode = (typeNode: TypeNode): NumericMode | null => {
	if (typeNode.typeName === "bigint") {
		return "bigint";
	}
	if (typeNode.typeName === "numeric") {
		return "string";
	}
	return null;
};

/** A synthetic `ColumnState` for a scalar return's own declared `TypeNode` — there is no real column declaration behind a `defineFunction` return, only the type it was declared with, so `notNull`/`primaryKey`/`unique`/`defaultValue` (properties of a *column*, not a *type*) are all their least-committal values; only `typeNode`/`mode` ever reach {@link convertRows}'s own conversion. */
const scalarColumnState = (typeNode: TypeNode): ColumnState => ({
	typeNode,
	notNull: false,
	primaryKey: false,
	unique: false,
	defaultValue: null,
	mode: defaultNumericMode(typeNode),
});

/** `scalarCall`'s own `columnState` derivation — a guard clause instead of a ternary (house style): `undefined` in, `undefined` out, matching `dispatchCall`'s fallback ("no declared type to convert against"). */
const scalarColumnStateFor = (
	typeNode: TypeNode | undefined,
): ColumnState | undefined => {
	if (typeNode === undefined) {
		return undefined;
	}
	return scalarColumnState(typeNode);
};

/**
 * The explicit `select fn(...) as "result"` plan for a scalar-returning
 * function (spec's "resolves to a value", not rows — owner's "explicit
 * SQL over implicit"): the aliased `"result"` key makes extraction
 * deterministic, never dependent on Postgres's own (dynamic, non-literal
 * — `FunctionDeclaration.functionName` is a plain `string`, never a
 * literal type) unaliased-column-naming convention. `typeNode` is
 * `undefined` when the declared return is a table this handle's own
 * declarations can't resolve (`dispatchCall`'s fallback) — there is
 * still exactly one result column, but no declared type to convert
 * against, so `columnState` stays `undefined` (the same "no declared
 * column" honesty as every other unresolved case, `convert.ts`, #311).
 */
const scalarCall = (
	declaration: FunctionDeclaration,
	placeholders: string,
	typeNode: TypeNode | undefined,
): {
	readonly compiled: CompileResult;
	readonly columnState: ColumnState | undefined;
} => {
	const ref = qualifyName(declaration.schemaName, declaration.functionName);
	return {
		compiled: {
			sql: `select ${ref}(${placeholders}) as "result"`,
			params: [],
			kind: "sql",
		},
		columnState: scalarColumnStateFor(typeNode),
	};
};

/** Guards the one precondition every call shares: the caller passed exactly as many arguments as `declaration` declares. Split out from {@link buildCall} so each function's own branch count stays low (CRAP ≤ 5). */
const assertArgCount = (
	declaration: FunctionDeclaration,
	args: ReadonlyArray<unknown>,
): void => {
	if (args.length !== declaration.args.length) {
		throwArgumentCountMismatch(
			declaration.functionName,
			declaration.args.length,
			args.length,
		);
	}
};

/** The two shapes a call can dispatch to — carried as a discriminated union (not two separate return types) so {@link callOne} can tell, after the fact, whether to extract one scalar value or convert a rows array; `callKind` is never surfaced past this file. */
type CallDispatch =
	| {
			readonly callKind: "scalar";
			readonly compiled: CompileResult;
			readonly columnState: ColumnState | undefined;
	  }
	| {
			readonly callKind: "rows";
			readonly compiled: CompileResult;
			readonly plan: ReadonlyArray<ColumnPlanEntry>;
	  };

/** Dispatches by `declaration.returns.returnsKind` once the argument count is already known valid — `setofTable` needs its target table resolved from `tables` (falling back to a bare scalar call, same as an unresolvable table, if it isn't there), `scalar` calls directly, `trigger` is never callable through `db.fn` at all. Split out from {@link buildCall} for the same CRAP reason as {@link assertArgCount}. */
const dispatchCall = (
	declaration: FunctionDeclaration,
	placeholders: string,
	tables: Declarations["tables"],
): CallDispatch => {
	if (declaration.returns.returnsKind === "trigger") {
		throwUnsupportedReturnKind(declaration.functionName);
	}
	if (declaration.returns.returnsKind === "scalar") {
		return {
			callKind: "scalar",
			...scalarCall(declaration, placeholders, declaration.returns.typeNode),
		};
	}
	const table = findTable(
		tables,
		declaration.returns.schemaName,
		declaration.returns.tableName,
	);
	if (table === undefined) {
		return {
			callKind: "scalar",
			...scalarCall(declaration, placeholders, undefined),
		};
	}
	return {
		callKind: "rows",
		...setofTableCall(declaration, table, placeholders),
	};
};

const buildCall = (
	declaration: FunctionDeclaration,
	args: ReadonlyArray<unknown>,
	tables: Declarations["tables"],
): CallDispatch => {
	assertArgCount(declaration, args);
	const placeholders = paramPlaceholders(args.length);
	return dispatchCall(declaration, placeholders, tables);
};

/** One `db.fn.*` entry: takes the call's positional arguments (declared order), resolves to a scalar value or a rows array depending on the declaration's own return shape — loosely typed here on purpose (`unknown`, since which shape a given call resolves to varies per declaration); `fn-types.ts` (task 4.10) is what narrows this per function for the public `db.fn` surface, via the same cast-at-return-boundary pattern this whole group uses throughout. */
export type FnCaller = (args: ReadonlyArray<unknown>) => Promise<unknown>;

/** `db.fn`'s own shape: one {@link FnCaller} per declared function, keyed by the declarations record's own export name (owner decision ③) — the same keys {@link Declarations}`.functions` already carries. */
export type FnApi = Readonly<Record<string, FnCaller>>;

/** Builds and throws the `function-scalar-result-missing`-coded, enriched plain `Error` (D57) — a `function` declaration. A scalar call always renders exactly one result column aliased `"result"` ({@link scalarCall}); anything else back from the driver (zero/multiple rows, a missing alias) means the function didn't behave like a scalar-returning one, and silently reading `undefined` here would let the promised scalar type lie about a value that was never there (the same class of guard `convert.ts`'s own `convertPlannedCell` enforces for a missing declared column). */
function throwScalarResultMissing(functionName: string): never {
	throw Object.assign(
		new Error(
			`db.fn call to "${functionName}" expected exactly one row with a "result" column, but the driver returned something else. Next: check the function actually returns a single scalar value (not a set, and not void).`,
		),
		{ code: "function-scalar-result-missing" },
	);
}

/** Extracts and converts the single scalar value a `"result"`-aliased call resolved to — reuses {@link convertRows} (the one conversion choke point every row goes through) on a synthetic one-row, one-column plan, rather than a second, disagreeing conversion path just for this case. */
const extractScalarValue = (
	rows: ReadonlyArray<DriverRow>,
	columnState: ColumnState | undefined,
	functionName: string,
): unknown => {
	const row = rows[0];
	if (rows.length !== 1 || row === undefined || !("result" in row)) {
		return throwScalarResultMissing(functionName);
	}
	const [converted] = convertRows([row], [{ alias: "result", columnState }]);
	if (converted === undefined) {
		return throwScalarResultMissing(functionName);
	}
	return converted.result;
};

/**
 * Runs one function call end to end: builds the parameterized SQL (task
 * 4.9), sends it via `run` — which decides *which* connection this lands
 * on (the top-level `db.fn`'s `run` hands `session` the driver itself and
 * sends immediately; `db.as(context).fn`'s `run` opens its own wrapping
 * transaction, applies the context, and only then calls back — task 4.7
 * × 4.9) — then resolves to a scalar value or a converted rows array
 * depending on `dispatchCall`'s own `callKind`, both funneled through
 * {@link convertRows}, exactly like every other execute call site in
 * this package.
 */
const callOne = async (
	run: (
		send: (session: DriverSession) => Promise<ReadonlyArray<DriverRow>>,
	) => Promise<ReadonlyArray<DriverRow>>,
	declaration: FunctionDeclaration,
	tables: Declarations["tables"],
	args: ReadonlyArray<unknown>,
): Promise<unknown> => {
	// buildCall can throw synchronously (argument-count/return-kind guards)
	// -- this function is itself `async` specifically so that throw becomes
	// a rejected promise for every caller, never a synchronous exception a
	// caller's own `await`/`.catch` wouldn't be positioned to catch.
	const dispatch = buildCall(declaration, args, tables);
	const withArgs: CompileResult = { ...dispatch.compiled, params: args };
	const rows = await run((session) => sendCompiled(session, withArgs));
	if (dispatch.callKind === "scalar") {
		return extractScalarValue(
			rows,
			dispatch.columnState,
			declaration.functionName,
		);
	}
	return convertRows(rows, dispatch.plan);
};

/**
 * Builds the `fn` member `db()`/`db.as(context)` assemble onto their
 * handle (task 4.9): `run` abstracts over "send on the driver directly"
 * (the unscoped `db.fn`) vs. "open a context-scoped transaction first"
 * (`db.as(context).fn`, task 4.7 × 4.9's cross-requirement) — `fn.ts`
 * itself never knows which.
 */
export const createFnApi = (
	run: (
		send: (session: DriverSession) => Promise<ReadonlyArray<DriverRow>>,
	) => Promise<ReadonlyArray<DriverRow>>,
	tables: Declarations["tables"],
	functions: Declarations["functions"],
): FnApi =>
	Object.fromEntries(
		Object.entries(functions).map(([key, declaration]) => [
			key,
			(args: ReadonlyArray<unknown>) => callOne(run, declaration, tables, args),
		]),
	);
