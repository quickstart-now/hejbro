import { quoteIdentifier } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import type { Driver, DriverSession } from "../driver/contract";
import { assertCapability } from "../driver/errors";
import type { ChainApi } from "./chain";
import { createChainApi } from "./chain";
import type { Declarations, ExecuteResult } from "./db";
import { executeOn, sendCompiled } from "./execute";

/**
 * What a `transaction()` callback receives — `execute` plus the same
 * thenable chain members every other surface carries (task 7.4, group 7
 * decision ③: the chain surface is identical on the unscoped handle,
 * `db.as` scope, and `tx`). There is no `.transaction` member here at all
 * (unlike {@link Driver}/`Db`), so `tx.transaction(...)` is a `tsc` error,
 * not a runtime one; the nested case this group actually has to guard
 * against is a callback closing over the *outer* `db` and calling
 * `db.transaction(...)` again, which `createTransactionApi`'s own `state`
 * below catches at runtime.
 *
 * `execute` resolves {@link ExecuteResult}`<TStatement>` — exactly the same
 * generic signature `Db["execute"]`/`ScopedDb["execute"]` carry (task 3.1,
 * #326): a `tx.select(...)` chain member and `tx.execute(select(...))` on
 * the very same `tx` now resolve the identical declared row type, whether
 * `tx` came from the unscoped `db.transaction` (`createTransactionApi`
 * below) or the scoped `db.as(context).transaction` (`context.ts`'s
 * `scopedTransaction`) — both build this same `Tx` via {@link buildTx}, so
 * there is exactly one place this generic signature is honored, not two
 * that could drift apart.
 */
export type Tx<TSchema = Record<string, unknown>> = ChainApi<TSchema> & {
	execute<TStatement extends CompileInput>(
		statement: TStatement,
	): Promise<ExecuteResult<TStatement>>;
	/**
	 * A nested transaction on the same connection, bracketed by a
	 * `SAVEPOINT` (#313): the callback's own statements are released into
	 * the enclosing transaction on normal return and rolled back to the
	 * savepoint on a thrown error, which is rethrown unchanged. Rolling
	 * back a savepoint does not abort the transaction containing it, so
	 * the outer callback can catch and carry on.
	 *
	 * This is the supported way to nest. Reaching back to the *outer
	 * handle's* `db.transaction(...)` from inside a callback still fails
	 * with `nested-transaction-unsupported` — that would take a second
	 * connection out of the pool, which is a different thing entirely and
	 * a deadlock waiting to happen, not a nesting of this transaction.
	 */
	transaction<T>(callback: (tx: Tx<TSchema>) => Promise<T>): Promise<T>;
};

/**
 * Builds the `tx` handle a callback receives, on `session` — the one
 * shared shape `transaction.ts`'s own `createTransactionApi` and
 * `context.ts`'s `scopedTransaction` both hand their callbacks (task 7.4):
 * the chain surface (`createChainApi`, tasks 7.1/7.2) parameterized by
 * `(send) => send(session)` (the session is already open and held by the
 * caller, so a chain member never needs to open one of its own — the same
 * "session already in hand" shape `db.fn`'s own `run` takes when it's
 * already inside a transaction), plus `execute`. One builder, not two
 * hand-written `Tx` object literals that could quietly drift apart on
 * which members they carry.
 */
/**
 * The savepoint counter one transaction's whole `tx` tree shares —
 * monotonic, never per-depth. Depth-keyed names would reuse a name after
 * a sibling rolled back to it (`ROLLBACK TO` keeps the savepoint alive),
 * leaving two live savepoints with one name; a counter cannot.
 */
export type SavepointCounter = { next: number };

/** Savepoint names are generated here and never caller-supplied, so quoting is belt-and-braces rather than the only defense (contrast `SET LOCAL ROLE` in `context.ts`). */
const savepointStatement = (verb: string, name: string): CompileResult => ({
	sql: `${verb} ${quoteIdentifier(name)}`,
	params: [],
	kind: "sql",
});

/** Rethrows the callback's own error after rolling back to `name`; a failing rollback means the connection itself is in trouble, so it surfaces as its own error rather than being swallowed — with the callback's error kept on the side so neither fact is lost. */
async function rollbackToSavepoint(
	session: DriverSession,
	name: string,
	callbackError: unknown,
): Promise<never> {
	try {
		await sendCompiled(
			session,
			savepointStatement("rollback to savepoint", name),
		);
	} catch (rollbackError) {
		throw Object.assign(
			new Error(
				`rolling back to savepoint "${name}" failed after the nested transaction callback threw. Next: inspect "cause" for the rollback failure and "callbackError" for what the callback threw -- the connection is likely no longer usable, and the enclosing transaction will roll back.`,
			),
			{
				code: "savepoint-rollback-failed",
				cause: rollbackError,
				callbackError,
			},
		);
	}
	throw callbackError;
}

/** Builds the `transaction` member a {@link Tx} carries — one savepoint per call, released on return and rolled back on a throw. */
const createSavepointApi = (
	session: DriverSession,
	tables: Declarations["tables"],
	counter: SavepointCounter,
): Tx["transaction"] =>
	(async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
		const name = `hejbro_sp_${counter.next}`;
		counter.next += 1;
		await sendCompiled(session, savepointStatement("savepoint", name));
		const result = await callback(buildTx(session, tables, counter)).catch(
			(error: unknown) => rollbackToSavepoint(session, name, error),
		);
		await sendCompiled(session, savepointStatement("release savepoint", name));
		return result;
	}) as Tx["transaction"];

export const buildTx = (
	session: DriverSession,
	tables: Declarations["tables"],
	counter: SavepointCounter = { next: 1 },
): Tx => ({
	...createChainApi((send) => send(session), tables),
	// executeOn's own runtime return is always the plain DriverRow shape --
	// this cast is ExecuteResult's compile-time-only narrowing of that same
	// value, never a distinct runtime reshape (same reasoning as db.ts's own
	// `executeImpl` cast).
	execute: ((statement: CompileInput) =>
		executeOn(session, statement, tables)) as Tx["execute"],
	transaction: createSavepointApi(session, tables, counter),
});

/** Builds and throws the `nested-transaction-unsupported`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). */
function throwNestedTransactionUnsupported(): never {
	throw Object.assign(
		new Error(
			'transaction() was called again on the db handle from inside an already-open transaction callback -- that would take a second connection out of the pool, not nest. Next: call transaction() on the "tx" handle the outer callback received, which nests on the same connection with a savepoint.',
		),
		{ code: "nested-transaction-unsupported" },
	);
}

/**
 * Builds the `transaction()` member `db()` assembles onto its handle
 * (task 4.6): begins one `BEGIN`/`COMMIT` via `driver.transaction`
 * (owner criterion, the driver itself decides commit-on-return vs.
 * rollback-on-throw, task 4.1's contract), rethrows the callback's own
 * error completely unchanged on failure (never wrapped, never
 * reinterpreted), and gives the callback a {@link Tx} whose `execute`
 * always runs through the one {@link DriverSession} `driver.transaction`
 * handed back — every statement in the callback provably shares that one
 * connection, never a fresh one per statement.
 *
 * One `state` object per built member (not per call) — closed over by
 * the returned function, `const`-bound but its own field mutated, never
 * reassigned — tracks whether a transaction issued by *this* member is
 * currently open, so a callback that reaches back to this very member
 * and calls it again gets `nested-transaction-unsupported` before the
 * capability check or any send; a different `db()` handle's own
 * `transaction()` is a different member with its own `state` and is
 * deliberately not guarded against here (it is a different connection
 * pool entirely, not a nesting of this one).
 */
export const createTransactionApi = (
	driver: Driver,
	tables: Declarations["tables"],
): (<T>(callback: (tx: Tx) => Promise<T>) => Promise<T>) => {
	const state = { active: false };
	return async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
		if (state.active) {
			throwNestedTransactionUnsupported();
		}
		assertCapability(driver, "interactive-transactions", "transaction");
		state.active = true;
		try {
			return await driver.transaction(async (session: DriverSession) =>
				callback(buildTx(session, tables)),
			);
		} finally {
			state.active = false;
		}
	};
};
