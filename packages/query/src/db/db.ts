import type { FunctionDeclaration, Table } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { Driver, DriverRow } from "../driver/contract";

/**
 * Everything a `db()` handle needs to know about the declared schema,
 * keyed the way the caller's own module already keys it (`{ tables: {
 * posts, comments } }`) — a plain shorthand-property object, the same
 * "record keyed by export name" reading owner decision ③ settles for
 * `db.fn` (task 4.9): JS can't introspect an export binding's name at
 * runtime, so the record's own keys stand in for it.
 *
 * `tables` is required (every table any statement can reach — including a
 * joined table never named directly by the caller's own `select()`/
 * `returning()` call — has to be resolvable here; task 4.4's single
 * column-meta resolver depends on this being complete, not just "the
 * tables this one query happens to mention"). `functions` is optional:
 * only `db.fn.*` (task 4.9) reads it, and not every declared schema
 * exposes callable functions.
 */
export type Declarations = {
	readonly tables: Readonly<Record<string, Table>>;
	readonly functions?: Readonly<Record<string, FunctionDeclaration>>;
};

/**
 * A `db()` handle. `execute` is every other db operation's foundation —
 * `transaction()` (4.6), `as()` (4.7), and `fn` (4.9) each start from
 * their own factory in their own file (`transaction.ts`/`context.ts`/
 * `fn.ts`) and this factory assembles their result onto the handle as a
 * real member (the delta specs' own `db.as`/`db.fn`/transaction-API SHALLs
 * require an owned member, not a free function taking `Db` as a
 * parameter) — `db.ts` is the one file allowed to grow across those
 * tasks to do that assembly.
 *
 * `declarations`/`driver` are exposed only as that **internal assembly
 * surface** for `transaction.ts`/`context.ts`/`fn.ts` to build against —
 * whether either is re-exported on the public barrel is group 7's call
 * (task 7.1), not decided here.
 */
export type Db = {
	readonly declarations: Declarations;
	readonly driver: Driver;
	execute(statement: CompileInput): Promise<ReadonlyArray<DriverRow>>;
};

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
 * Builds a `db()` handle bound to `driver`. `execute` hands `driver` the
 * exact {@link CompileResult} `compile()` itself would preview for the
 * same statement — `sql`, `params`, and `kind` together, never `sql`/
 * `params` unpacked into separate arguments — so `kind` reaches the
 * driver boundary unchanged (task 4.3). A driver rejection wraps as
 * `query-execution-failed` (task 4.5): the message carries the
 * parameterized SQL text (every value already a `$n` placeholder by the
 * time `compile()` produced it) and `kind`, the driver's own error
 * becomes `cause`, and `compiled.params` never appears anywhere on the
 * thrown error.
 */
export const db = (declarations: Declarations, driver: Driver): Db => ({
	declarations,
	driver,
	execute: async (statement) => {
		const compiled = compile(statement);
		try {
			return await driver.execute(compiled);
		} catch (cause) {
			return throwQueryExecutionFailed(compiled, cause);
		}
	},
});
