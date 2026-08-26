import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverRow, DriverSession } from "../driver/contract";

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
 * Compiles `statement` and executes it against `session` — the one
 * execute-plus-error-wrap pipeline every execute call site in this
 * package shares: `db().execute` (task 4.5) and a transaction's
 * `tx.execute` (task 4.6) both call this, so a statement run inside a
 * transaction gets the exact same `query-execution-failed` contract
 * (parameterized SQL text, `kind`, driver error as `cause`, `params`
 * never on the thrown error) as one run outside it — one pipeline, not
 * two that could quietly drift apart.
 */
export const executeOn = async (
	session: DriverSession,
	statement: CompileInput,
): Promise<ReadonlyArray<DriverRow>> => {
	const compiled = compile(statement);
	try {
		return await session.execute(compiled);
	} catch (cause) {
		return throwQueryExecutionFailed(compiled, cause);
	}
};
