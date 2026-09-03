import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverRow, DriverSession } from "../driver/contract";
import { columnPlanForStatement, convertRows } from "./convert";
import type { Declarations } from "./db";

/** The driver's own reason, extracted for the wrapper's message. Text the database echoed into its message is carried verbatim, never scrubbed — this layer only guarantees it writes no parameter value itself (the spec's value guarantee is scoped to this layer's own writes). */
function describeCause(cause: unknown): string {
	if (cause instanceof Error && cause.message !== "") {
		return cause.message;
	}
	if (typeof cause === "string" && cause !== "") {
		return cause;
	}
	return "(the driver rejected with a non-error value or no message)";
}

/** Builds and throws the `query-execution-failed`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). Never retries, never reinterprets `cause`; `compiled.params` is deliberately never read here, so it can never reach the message, an own field, or (via a later `Object.assign`) the error's own enumerable surface. The driver's reason leads the message — the SQL can be arbitrarily long, and default views truncate (#427). */
function throwQueryExecutionFailed(
	compiled: CompileResult,
	cause: unknown,
): never {
	throw Object.assign(
		new Error(
			`query execution failed for this "${compiled.kind}" statement: ${describeCause(cause)}. Statement: ${compiled.sql}. Next: the driver's full error (fields like "detail" and "hint" included) is on "cause" -- this wrapper never retries or reinterprets it.`,
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
 * rejection. Exported for `context.ts`'s `db.as` (task 4.7): applying a
 * context's role/settings is raw SQL this package builds itself, never
 * routed through `compile()` (there is no builder-stage statement behind
 * `set local role …`/`select set_config(...)`), but it still deserves
 * the exact same query-execution-failed contract as everything else.
 */
export const sendCompiled = async (
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
