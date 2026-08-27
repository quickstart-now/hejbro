import type {
	ColumnState,
	FunctionDeclaration,
	NumericMode,
	Table,
	TypeNode,
} from "@hejbro/core";
import {
	getTableMeta,
	qualifyName,
	quoteIdentifier,
	toSnakeCase,
} from "@hejbro/core";
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
 * Mirrors `@hejbro/core`'s own "no mode" defaults (`bigint` type ->
 * `'bigint'` mode, `numeric` type -> `'string'` mode, same values
 * `ts-type-map.ts`'s `BaseScalarTsType` fallback resolves) — a
 * `defineFunction({returns: <TypeNode>})` scalar return has no column
 * declaration to carry an explicit `bigint({mode})`/`numeric({mode})`
 * choice, so this fills exactly the same default the type-level
 * `BaseTsType` mapping already assumes when `TMeta.mode` is absent,
 * keeping the runtime conversion and the compile-time type in agreement.
 *
 * **Deliberately a second, hand-spelled copy, not an import** (#310):
 * core's own default-mode constants (`numeric-mode-defaults.ts`) are
 * intentionally *not* part of `@hejbro/core`'s public barrel — they are
 * internal wiring between core's own factories and its own type map, not
 * a contract this package is entitled to depend on. Unifying the two
 * would mean widening core's public API surface for this one mirror,
 * which this task never decided; this mirror is the boundary's own
 * consequence, kept in sync by hand (and by `fn.test.ts`'s own drift
 * guard) rather than by a shared import.
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

/**
 * The explicit `select fn(...) as "result"` plan for a scalar-returning
 * function (spec's "resolves to a value", not rows — owner's "explicit
 * SQL over implicit"): the aliased `"result"` key makes extraction
 * deterministic, never dependent on Postgres's own (dynamic, non-literal
 * — `FunctionDeclaration.functionName` is a plain `string`, never a
 * literal type) unaliased-column-naming convention.
 */
const scalarCall = (
	declaration: FunctionDeclaration,
	placeholders: string,
	typeNode: TypeNode,
): {
	readonly compiled: CompileResult;
	readonly columnState: ColumnState;
} => {
	const ref = qualifyName(declaration.schemaName, declaration.functionName);
	return {
		compiled: {
			sql: `select ${ref}(${placeholders}) as "result"`,
			params: [],
			kind: "sql",
		},
		columnState: scalarColumnState(typeNode),
	};
};

/** Builds and throws the `function-target-table-undeclared`-coded, enriched plain `Error` (D57) — a `function` declaration. A `returns: setofTable` function whose target table isn't in *this* handle's own declarations used to fall back to a bare, untyped scalar call (task 4.9) — an implicit guess this project consistently rejects elsewhere (never `select *`, capability checks fail closed, an undeclared role has no escape hatch); the declared return type (`ReadonlyArray<SelectResult<TTable>>`, task 4.10) would keep promising rows while the runtime silently produced a bare value, the same "type lies" shape 4.4-wiring and the missing-`"result"`-key guard both existed to rule out. Failing fast here instead names exactly what's missing and how to fix it. */
function throwTargetTableUndeclared(
	functionName: string,
	schemaName: string,
	tableName: string,
): never {
	throw Object.assign(
		new Error(
			`db.fn call to "${functionName}" declares "returns: <table>" for "${schemaName}.${tableName}", but that table isn't declared in this db() handle's own schema module. Next: add "${tableName}"'s table() declaration to the schema module passed to db(...).`,
		),
		{ code: "function-target-table-undeclared", schemaName, tableName },
	);
}

/** Guards the one precondition every call shares: the caller's named-argument object carries exactly as many keys as `declaration` declares. Split out from {@link buildCall} so each function's own branch count stays low (CRAP ≤ 5). A mismatched *name* (typo, wrong key) is TypeScript's job to reject before this ever runs (task 4.10's own `@ts-expect-error` probes); this is only the runtime's last-resort count sanity check, matching the spec's "no runtime coercion" (there is no attempt here to guess which name a caller meant). */
const assertArgCount = (
	declaration: FunctionDeclaration,
	namedArgs: Readonly<Record<string, unknown>>,
): void => {
	const actual = Object.keys(namedArgs).length;
	if (actual !== declaration.args.length) {
		throwArgumentCountMismatch(
			declaration.functionName,
			declaration.args.length,
			actual,
		);
	}
};

/**
 * Maps a call's own named-argument object to the positional array
 * `declaration.args`'s own declared order expects — matched by *name*
 * (each declared argument's own `toSnakeCase`-transformed counterpart in
 * the caller's object), **never by the caller's own key insertion order**
 * (`Object.values(namedArgs)` would silently swap two arguments if a
 * caller writes them in a different order than they were declared —
 * JS object key order is call-site-dependent, not declaration-order,
 * owner's own explicit warning for this task). A declared argument the
 * caller's object doesn't (yet, past `assertArgCount`'s count check)
 * carry resolves to `undefined` positionally, exactly like any other
 * missing value this package already passes through to `liftOperand`
 * elsewhere.
 */
const resolvePositionalArgs = (
	declaration: FunctionDeclaration,
	namedArgs: Readonly<Record<string, unknown>>,
): ReadonlyArray<unknown> => {
	const callerKeys = Object.keys(namedArgs);
	return declaration.args.map((argDecl) => {
		const matchingKey = callerKeys.find(
			(key) => toSnakeCase(key) === argDecl.argName,
		);
		if (matchingKey === undefined) {
			return undefined;
		}
		return namedArgs[matchingKey];
	});
};

/** The two shapes a call can dispatch to — carried as a discriminated union (not two separate return types) so {@link callOne} can tell, after the fact, whether to extract one scalar value or convert a rows array; `callKind` is never surfaced past this file. */
type CallDispatch =
	| {
			readonly callKind: "scalar";
			readonly compiled: CompileResult;
			readonly columnState: ColumnState;
	  }
	| {
			readonly callKind: "rows";
			readonly compiled: CompileResult;
			readonly plan: ReadonlyArray<ColumnPlanEntry>;
	  };

/** Dispatches by `declaration.returns.returnsKind` once the argument count is already known valid — `setofTable` needs its target table resolved from `tables` (failing fast, never a silent scalar guess, if it isn't there — owner's "explicit over implicit"), `scalar` calls directly, `trigger` is never callable through `db.fn` at all. Split out from {@link buildCall} for the same CRAP reason as {@link assertArgCount}. */
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
	const { schemaName, tableName } = declaration.returns;
	const table = findTable(tables, schemaName, tableName);
	if (table === undefined) {
		return throwTargetTableUndeclared(
			declaration.functionName,
			schemaName,
			tableName,
		);
	}
	return {
		callKind: "rows",
		...setofTableCall(declaration, table, placeholders),
	};
};

const buildCall = (
	declaration: FunctionDeclaration,
	namedArgs: Readonly<Record<string, unknown>>,
	tables: Declarations["tables"],
): {
	readonly dispatch: CallDispatch;
	readonly positionalArgs: ReadonlyArray<unknown>;
} => {
	assertArgCount(declaration, namedArgs);
	const positionalArgs = resolvePositionalArgs(declaration, namedArgs);
	const placeholders = paramPlaceholders(positionalArgs.length);
	return {
		dispatch: dispatchCall(declaration, placeholders, tables),
		positionalArgs,
	};
};

/** One `db.fn.*` entry: takes the call's own named-argument object (owner decision — a direct translation of `TArgs`'s own named shape, not a positional tuple), resolves to a scalar value or a rows array depending on the declaration's own return shape — loosely typed here on purpose (`Record<string, unknown>` in, `unknown` out, since both vary per declaration); `fn-types.ts` (task 4.10) is what narrows this per function for the public `db.fn` surface, via the same cast-at-return-boundary pattern this whole group uses throughout. The SQL itself still renders positional parameters, in declared order — {@link resolvePositionalArgs} is the one place that conversion happens. */
export type FnCaller = (
	args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

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
	// convertRows maps 1:1 over its input -- a length-1 input always
	// produces a length-1 output, so `converted` is unconditionally
	// defined here; `noUncheckedIndexedAccess` still requires this to be
	// spelled as an optional access, not a real optional path (nothing
	// left for a test to leave uncovered -- CRAP follow-up, batch C).
	const [converted] = convertRows([row], [{ alias: "result", columnState }]);
	return converted?.result;
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
	namedArgs: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
	// buildCall can throw synchronously (argument-count/return-kind guards)
	// -- this function is itself `async` specifically so that throw becomes
	// a rejected promise for every caller, never a synchronous exception a
	// caller's own `await`/`.catch` wouldn't be positioned to catch.
	const { dispatch, positionalArgs } = buildCall(
		declaration,
		namedArgs,
		tables,
	);
	const withArgs: CompileResult = {
		...dispatch.compiled,
		params: positionalArgs,
	};
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
			(args: Readonly<Record<string, unknown>>) =>
				callOne(run, declaration, tables, args),
		]),
	);
