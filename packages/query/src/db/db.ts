import type { FunctionDeclaration, Table } from "@hejbro/core";
import type { CompileInput } from "../compile/compile";
import type { Driver, DriverRow } from "../driver/contract";
import { executeOn } from "./execute";
import type { Tx } from "./transaction";
import { createTransactionApi } from "./transaction";

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
	/**
	 * Runs `callback` inside one transaction (task 4.6): commits and
	 * resolves the callback's own return value on success; on a thrown
	 * error, rolls back and rethrows that exact error, unchanged. Checks
	 * `"interactive-transactions"` before any send (task 4.2's guard), and
	 * fails fast with `nested-transaction-unsupported` when called again
	 * from inside an already-open callback of this same member.
	 */
	transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
};

/**
 * Builds a `db()` handle bound to `driver`. `execute` hands `driver` the
 * exact {@link CompileResult} `compile()` itself would preview for the
 * same statement — `sql`, `params`, and `kind` together, never `sql`/
 * `params` unpacked into separate arguments — so `kind` reaches the
 * driver boundary unchanged (task 4.3). A driver rejection wraps as
 * `query-execution-failed` (task 4.5, `./execute.ts`'s `executeOn`): the
 * message carries the parameterized SQL text (every value already a `$n`
 * placeholder by the time `compile()` produced it) and `kind`, the
 * driver's own error becomes `cause`, and `compiled.params` never
 * appears anywhere on the thrown error. `transaction` is assembled from
 * `./transaction.ts`'s own factory (task 4.6) so a statement run inside
 * it shares that exact same `executeOn` pipeline.
 */
export const db = (declarations: Declarations, driver: Driver): Db => ({
	declarations,
	driver,
	execute: (statement) => executeOn(driver, statement),
	transaction: createTransactionApi(driver),
});
