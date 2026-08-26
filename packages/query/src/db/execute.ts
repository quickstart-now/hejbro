import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverRow, DriverSession } from "../driver/contract";
import { columnPlanForStatement, convertRows } from "./convert";
import type { Declarations } from "./db";

/** Builds and throws the `query-execution-failed`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). Never retries, never reinterprets `cause`; `compiled.params` is deliberately never read here, so it can never reach the message, an own field, or (via a later `Object.assign`) the error's own enumerable surface. */
function throwQueryExecutionFailed(
	compiled: CompileResult,
	cause: unknown,
): never {
	throw Object.assign(
		new Error(
			`query execution failed for this "${compiled.kind}" statement: ${compiled.sql}. Next: inspect the underlying driver error via "cause" -- this wrapper never retries or reinterprets it.`,
		),
		{ code: "query-execution-failed", kind: compiled.kind, cause },
	);
}

/**
 * Sends `compiled` to `session` and wraps a driver rejection as
 * `query-execution-failed` — kept separate from {@link executeOn} so a
 * *conversion* failure (task 4.4/4.4-wiring's `result-conversion-failed`,
 * thrown after this returns) is never caught here and misreported as an
 * execution failure; this `try`/`catch` only ever sees the driver's own
 * rejection.
 */
const sendCompiled = async (
	session: DriverSession,
	compiled: CompileResult,
): Promise<ReadonlyArray<DriverRow>> => {
	try {
		return await session.execute(compiled);
	} catch (cause) {
		return throwQueryExecutionFailed(compiled, cause);
	}
};

/**
 * Compiles `statement`, executes it against `session`, and converts the
 * returned rows per `tables` — the one execute-plus-convert pipeline
 * every execute call site in this package shares: `db().execute` (task
 * 4.5) and a transaction's `tx.execute` (task 4.6) both call this, so a
 * statement run inside a transaction gets the exact same
 * `query-execution-failed`/`result-conversion-failed` contract, and the
 * exact same numeric-mode/`IntervalValue` conversion (task 4.4-wiring),
 * as one run outside it — one pipeline, not two that could quietly drift
 * apart, and not a runtime shape that lies about {@link ExecuteResult}'s
 * compile-time promise (`db.ts`) the way it did before this task.
 */
export const executeOn = async (
	session: DriverSession,
	statement: CompileInput,
	tables: Declarations["tables"],
): Promise<ReadonlyArray<DriverRow>> => {
	const compiled = compile(statement);
	const rows = await sendCompiled(session, compiled);
	const plan = columnPlanForStatement(statement, tables);
	return convertRows(rows, plan);
};
