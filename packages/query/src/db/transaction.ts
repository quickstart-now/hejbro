import type { CompileInput } from "../compile/compile";
import type { Driver, DriverRow, DriverSession } from "../driver/contract";
import { assertCapability } from "../driver/errors";
import { executeOn } from "./execute";

/**
 * What a `transaction()` callback receives — `execute` only. There is no
 * `.transaction` member here at all (unlike {@link Driver}/`Db`), so
 * `tx.transaction(...)` is a `tsc` error, not a runtime one; the nested
 * case this group actually has to guard against is a callback closing
 * over the *outer* `db` and calling `db.transaction(...)` again, which
 * `createTransactionApi`'s own `state` below catches at runtime.
 */
export type Tx = {
	execute(statement: CompileInput): Promise<ReadonlyArray<DriverRow>>;
};

/** Builds and throws the `nested-transaction-unsupported`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). */
function throwNestedTransactionUnsupported(): never {
	throw Object.assign(
		new Error(
			'transaction() was called again from inside an already-open transaction callback. Next: savepoints aren\'t supported yet (#313) -- issue every statement for this transaction through the one "tx" handle the outer callback already received, instead of calling transaction() a second time.',
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
): (<T>(callback: (tx: Tx) => Promise<T>) => Promise<T>) => {
	const state = { active: false };
	return async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
		if (state.active) {
			throwNestedTransactionUnsupported();
		}
		assertCapability(driver, "interactive-transactions", "transaction");
		state.active = true;
		try {
			return await driver.transaction(async (session: DriverSession) => {
				const tx: Tx = {
					execute: (statement) => executeOn(session, statement),
				};
				return callback(tx);
			});
		} finally {
			state.active = false;
		}
	};
};
