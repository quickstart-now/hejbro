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
 * `db.as` scope, and `tx`), plus its own `transaction` member for nesting
 * on the same connection via a savepoint. Reaching back to the *outer*
 * `db` handle and calling `db.transaction(...)` again from inside a
 * callback is a different thing entirely — a second connection out of the
 * pool, not a nesting of this one — and still fails with
 * `nested-transaction-unsupported`, caught by `createTransactionApi`'s own
 * `state` below.
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
	 * savepoint on a thrown error (synchronous or rejected alike), which is
	 * rethrown unchanged. Rolling back a savepoint does not abort the
	 * transaction containing it, so the outer callback can catch and carry
	 * on; a rolled-back savepoint is also released, so a transaction that
	 * nests repeatedly does not grow its savepoint stack for its own
	 * lifetime.
	 *
	 * This is the supported way to nest — but only one at a time per `tx`:
	 * savepoints on one connection are strictly nested, so starting a
	 * second nested transaction on this same `tx` while the first is still
	 * in flight fails immediately with `concurrent-nested-transaction`,
	 * before any savepoint statement is sent. Await one before starting the
	 * next. Reaching back to the *outer handle's* `db.transaction(...)`
	 * from inside a callback still fails with
	 * `nested-transaction-unsupported` — that would take a second
	 * connection out of the pool, which is a different thing entirely and
	 * a deadlock waiting to happen, not a nesting of this transaction.
	 */
	transaction<T>(callback: (tx: Tx<TSchema>) => Promise<T>): Promise<T>;
};

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

/** Builds and throws the `concurrent-nested-transaction`-coded error (D57) guarding the shape #445/D1 found: two sibling `tx.transaction()` calls on one connection interleave one SAVEPOINT sequence, which can silently discard a sibling's already-resolved work or abort the whole transaction, depending on the interleaving. */
function throwConcurrentNestedTransaction(): never {
	throw Object.assign(
		new Error(
			'transaction() was called on this "tx" while a previous nested transaction started from it is still in flight. Next: await one nested transaction before starting the next on the same "tx" -- concurrent siblings would interleave one SAVEPOINT sequence on a single connection, which can silently discard one sibling\'s work or abort the whole transaction depending on the interleaving.',
		),
		{ code: "concurrent-nested-transaction" },
	);
}

/** Attempts `ROLLBACK TO SAVEPOINT "name"`, throwing the `savepoint-rollback-failed`-coded error (carrying both the rollback failure and whatever reason triggered the rollback -- a thrown callback error or a failed release) if that itself fails; resolves silently on success so both callers can layer their own outcome on top. */
async function rollbackOrFail(
	session: DriverSession,
	name: string,
	reason: unknown,
): Promise<void> {
	try {
		await sendCompiled(
			session,
			savepointStatement("rollback to savepoint", name),
		);
	} catch (rollbackError) {
		throw Object.assign(
			new Error(
				`rolling back to savepoint "${name}" failed after the nested transaction callback threw. Do not catch this error: if it escapes the enclosing callback the transaction rolls back, and if you catch it the transaction can still commit without the nested work. Next: inspect "cause" for the rollback failure and "callbackError" for what the callback threw -- when the rollback failed because the connection itself is unusable, letting this error escape is also what gets that connection discarded.`,
			),
			{
				code: "savepoint-rollback-failed",
				cause: rollbackError,
				callbackError: reason,
			},
		);
	}
}

/** Rethrows the callback's own error after rolling back to `name` and releasing that savepoint (#445 nit -- `ROLLBACK TO` alone keeps the savepoint alive, so leaving it unreleased would grow the savepoint stack for the life of a transaction that nests repeatedly); a failing rollback surfaces as its own `savepoint-rollback-failed` error instead, via {@link rollbackOrFail}. */
async function rollbackToSavepoint(
	session: DriverSession,
	name: string,
	callbackError: unknown,
): Promise<never> {
	await rollbackOrFail(session, name, callbackError);
	await sendCompiled(session, savepointStatement("release savepoint", name));
	throw callbackError;
}

/** A statement error swallowed inside a nested callback leaves the subtransaction aborted, so the `RELEASE SAVEPOINT` that follows its normal return fails (#445 R2). Attempts `ROLLBACK TO SAVEPOINT` to recover -- surfacing `savepoint-release-failed` on success, or letting the existing rollback-failure path in {@link rollbackOrFail} take over if that recovery itself fails. */
async function recoverFromFailedRelease(
	session: DriverSession,
	name: string,
	releaseError: unknown,
): Promise<never> {
	await rollbackOrFail(session, name, releaseError);
	// best-effort: ROLLBACK TO clears the aborted state, so the savepoint
	// can actually be released now, keeping the "no savepoint outlives its
	// nested transaction" invariant (task 1.4) even on this failure exit. A
	// second failure here doesn't change what's surfaced -- the error
	// identity stays pinned to the original release failure below.
	await sendCompiled(
		session,
		savepointStatement("release savepoint", name),
	).catch(() => {});
	throw Object.assign(
		new Error(
			`releasing savepoint "${name}" failed, most likely because a statement error was swallowed inside its nested transaction callback and left the subtransaction aborted. Rolling back to the savepoint recovered the connection. Next: rethrow statement errors inside a nested transaction callback instead of swallowing them -- inspect "cause" for the release failure this triggered.`,
		),
		{ code: "savepoint-release-failed", cause: releaseError },
	);
}

/** Builds the `transaction` member a {@link Tx} carries — one savepoint per call, released on return and rolled back on a throw, guarded against a second nested transaction starting on this same `tx` while one is still in flight (#445/D1). */
const createSavepointApi = (
	session: DriverSession,
	tables: Declarations["tables"],
	counter: SavepointCounter,
): Tx["transaction"] => {
	const state = { active: false };
	return (async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
		if (state.active) {
			throwConcurrentNestedTransaction();
		}
		state.active = true;
		try {
			const name = `hejbro_sp_${counter.next}`;
			counter.next += 1;
			await sendCompiled(session, savepointStatement("savepoint", name));
			let result: T;
			try {
				result = await callback(buildTx(session, tables, counter));
			} catch (callbackError) {
				return await rollbackToSavepoint(session, name, callbackError);
			}
			try {
				await sendCompiled(
					session,
					savepointStatement("release savepoint", name),
				);
			} catch (releaseError) {
				return await recoverFromFailedRelease(session, name, releaseError);
			}
			return result;
		} finally {
			state.active = false;
		}
	}) as Tx["transaction"];
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
