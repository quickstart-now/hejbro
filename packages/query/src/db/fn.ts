import type { FunctionDeclaration, Table } from "@hejbro/core";
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

/** The `select <fn>(...)` plan for a scalar-returning function — no declared column backs the result (a scalar return isn't a table column), so it passes through unconverted, matching every other "no declared column" case in this package (`convert.ts`, #311). */
const scalarCall = (
	declaration: FunctionDeclaration,
	placeholders: string,
): {
	readonly compiled: CompileResult;
	readonly plan: ReadonlyArray<ColumnPlanEntry>;
} => {
	const ref = qualifyName(declaration.schemaName, declaration.functionName);
	return {
		compiled: {
			sql: `select ${ref}(${placeholders})`,
			params: [],
			kind: "sql",
		},
		plan: [],
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

/** Dispatches by `declaration.returns.returnsKind` once the argument count is already known valid — `setofTable` needs its target table resolved from `tables` (falling back to a bare scalar call, same as an unresolvable table, if it isn't there), `scalar` calls directly, `trigger` is never callable through `db.fn` at all. Split out from {@link buildCall} for the same CRAP reason as {@link assertArgCount}. */
const dispatchCall = (
	declaration: FunctionDeclaration,
	placeholders: string,
	tables: Declarations["tables"],
): {
	readonly compiled: CompileResult;
	readonly plan: ReadonlyArray<ColumnPlanEntry>;
} => {
	if (declaration.returns.returnsKind === "trigger") {
		throwUnsupportedReturnKind(declaration.functionName);
	}
	if (declaration.returns.returnsKind === "scalar") {
		return scalarCall(declaration, placeholders);
	}
	const table = findTable(
		tables,
		declaration.returns.schemaName,
		declaration.returns.tableName,
	);
	if (table === undefined) {
		return scalarCall(declaration, placeholders);
	}
	return setofTableCall(declaration, table, placeholders);
};

const buildCall = (
	declaration: FunctionDeclaration,
	args: ReadonlyArray<unknown>,
	tables: Declarations["tables"],
): {
	readonly compiled: CompileResult;
	readonly plan: ReadonlyArray<ColumnPlanEntry>;
} => {
	assertArgCount(declaration, args);
	const placeholders = paramPlaceholders(args.length);
	return dispatchCall(declaration, placeholders, tables);
};

/** One `db.fn.*` entry: takes the call's positional arguments (declared order), returns the converted rows. */
export type FnCaller = (
	args: ReadonlyArray<unknown>,
) => Promise<ReadonlyArray<DriverRow>>;

/** `db.fn`'s own shape: one {@link FnCaller} per declared function, keyed by the declarations record's own export name (owner decision ③) — the same keys {@link Declarations}`.functions` already carries. */
export type FnApi = Readonly<Record<string, FnCaller>>;

/**
 * Runs one function call end to end: builds the parameterized SQL (task
 * 4.9), sends it via `run` — which decides *which* connection this lands
 * on (the top-level `db.fn`'s `run` hands `session` the driver itself and
 * sends immediately; `db.as(context).fn`'s `run` opens its own wrapping
 * transaction, applies the context, and only then calls back — task 4.7
 * × 4.9) — and converts the returned rows through {@link convertRows},
 * exactly like every other execute call site in this package.
 */
const callOne = async (
	run: (
		send: (session: DriverSession) => Promise<ReadonlyArray<DriverRow>>,
	) => Promise<ReadonlyArray<DriverRow>>,
	declaration: FunctionDeclaration,
	tables: Declarations["tables"],
	args: ReadonlyArray<unknown>,
): Promise<ReadonlyArray<DriverRow>> => {
	// buildCall can throw synchronously (argument-count/return-kind guards)
	// -- this function is itself `async` specifically so that throw becomes
	// a rejected promise for every caller, never a synchronous exception a
	// caller's own `await`/`.catch` wouldn't be positioned to catch.
	const { compiled, plan } = buildCall(declaration, args, tables);
	const withArgs: CompileResult = { ...compiled, params: args };
	return run(async (session) => {
		const rows = await sendCompiled(session, withArgs);
		return convertRows(rows, plan);
	});
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
