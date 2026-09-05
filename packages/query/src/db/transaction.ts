import { quoteIdentifier } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import type { Driver, DriverSession } from "../driver/contract";
import { assertCapability } from "../driver/errors";
import type { ChainApi } from "./chain";
import { createChainApi } from "./chain";
import type { Declarations, ExecuteResult } from "./db";
import { executeOn, sendCompiled } from "./execute";

/**
 * The operation name every interactive-only transaction surface asserts
 * and reports under (task 1.3, #486): `context.ts`'s
 * `capabilitiesForOperation` compares against this same constant (not a
 * repeated string literal) to decide the single-key vs. two-key assert,
 * so renaming this can never silently let the callback-scoped surface
 * fall through to the batch-eligible two-key path -- a callback is
 * inherently interactive.
 */
export const TRANSACTION_OPERATION = "transaction";

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
 * One `tx`'s own place in its {@link TransactionTree} -- `settled` marks
 * that this token's own transaction has ended (released/rolled back for
 * a nested one, committed/rolled back for the root), so a statement
 * through it would land somewhere it does not belong: inside the
 * enclosing transaction unbracketed for a nested token (#449, task 1.4),
 * or on whatever connection the pool hands out next, outside any
 * transaction, for the root token (#449, task 1.4c). `kind` picks which
 * of those two truths the settled refusal states.
 */
export type TxToken = {
	settled: boolean;
	readonly kind: "root" | "nested";
	/** The token this nested transaction was started from -- walked upward when it settles, so the tree's innermost never lands on a token that settled meanwhile (D106 round 1, NB4). */
	readonly parent?: TxToken;
};

/** The nearest token in the chain that is still in flight -- `token` itself, or the first unsettled ancestor. */
const liveAncestor = (token: TxToken): TxToken => {
	if (!token.settled || token.parent === undefined) {
		return token;
	}
	return liveAncestor(token.parent);
};

/**
 * One transaction's whole `tx` tree shares this state (#449): `next` is
 * the savepoint counter -- monotonic, never per-depth, since depth-keyed
 * names would reuse a name after a sibling rolled back to it (`ROLLBACK
 * TO` keeps the savepoint alive), leaving two live savepoints with one
 * name; a counter cannot. `innermost` names which `tx` in the tree may
 * currently send: the outermost `tx`'s own token at rest, reassigned to
 * a nested transaction's fresh token for the span its callback is in
 * flight (before its own `SAVEPOINT` is even sent, so a statement raced
 * against it synchronously never slips through), and restored once that
 * nested transaction has settled either way -- this reassignment is
 * shared by every `tx` in the tree, not just the one that started the
 * nested transaction, so a grandparent's own statement is refused
 * exactly like the immediate parent's.
 */
export type TransactionTree = { next: number; innermost: TxToken };

/** Refuses `token` outright once its own transaction has settled (#449): `statement-after-transaction` for the root token, `statement-after-nested-transaction` for a nested one (task 1.4c) -- shared by every surface a settled token can still be reached through: `execute`, a chain member, `with`, and `token`'s own `transaction()` member alike (task 1.4b/1.4c), so a settled root handle's `transaction()` call is refused under its own code, not the nested one. */
function assertNotSettled(token: TxToken): void {
	if (!token.settled) {
		return;
	}
	if (token.kind === "root") {
		throwStatementAfterTransaction();
	}
	throwStatementAfterNestedTransaction();
}

/** Refuses a statement sent through `token` (#449): {@link assertNotSettled} takes precedence, since that check is true regardless of what `tree.innermost` currently holds; otherwise `token` not being `tree`'s own innermost in-flight token picks `statement-during-nested-transaction` -- only the innermost `tx` of a transaction tree may send while a nested transaction is in flight. */
function assertInnermost(tree: TransactionTree, token: TxToken): void {
	assertNotSettled(token);
	if (tree.innermost !== token) {
		throwStatementDuringNestedTransaction();
	}
}

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

/** Builds and throws the `statement-during-nested-transaction`-coded error (D57) guarding the shape #449 found: a statement sent through a `tx` that is not the innermost in-flight transaction lands inside that nested transaction's own savepoint bracket and shares its fate -- rolled back with it, silently, if the nested callback throws. */
function throwStatementDuringNestedTransaction(): never {
	throw Object.assign(
		new Error(
			'a statement was sent through this "tx" while a nested transaction started from it (or from a "tx" above it) is still in flight. Next: issue this statement through the nested callback\'s own "tx" when it belongs to that nested work, or await the nested transaction first when it does not.',
		),
		{ code: "statement-during-nested-transaction" },
	);
}

/** Builds and throws the `statement-after-nested-transaction`-coded error (D57), the settled sibling of {@link throwStatementDuringNestedTransaction} (#449, task 1.4): a `tx` handed to a nested callback is that nested transaction and nothing else -- once its callback has settled, its savepoint no longer exists, and a statement sent through it would land in the enclosing transaction unbracketed. */
function throwStatementAfterNestedTransaction(): never {
	throw Object.assign(
		new Error(
			'a statement was sent through a "tx" whose own nested transaction has already settled (released or rolled back) -- that "tx" was that nested transaction and nothing else, and its savepoint no longer exists. Next: issue this statement through the enclosing "tx" instead.',
		),
		{ code: "statement-after-nested-transaction" },
	);
}

/** Builds and throws the `statement-after-transaction`-coded error (D57), the root-token sibling of {@link throwStatementAfterNestedTransaction} (#449, task 1.4c review repair): the `tx` a `transaction()` callback itself received is that transaction and nothing else -- once the callback has settled (committed or rolled back), its connection has gone back to the pool, and a statement sent through the kept handle would run on whatever connection the driver hands out next, outside any transaction, committing on its own with no error. */
function throwStatementAfterTransaction(): never {
	throw Object.assign(
		new Error(
			'a statement was sent through a "tx" whose own transaction() callback has already settled (committed or rolled back) -- its connection has gone back to the pool, and a statement sent through it now would run outside any transaction. Next: open a new transaction() call for further work.',
		),
		{ code: "statement-after-transaction" },
	);
}

/**
 * What triggered a rollback attempt, and how {@link rollbackOrFail}'s own
 * failure message should describe it (#445 review B2) -- `rollbackOrFail`
 * is shared by two callers with genuinely different truths: a thrown
 * callback (`rollbackToSavepoint`) and a normally-returned callback whose
 * `RELEASE` failed (`recoverFromFailedRelease`). Reusing one hard-coded "…
 * callback threw" message for both would state something false on the
 * second path -- exactly the defect class R1 (1.5) fixed on this same
 * function, reintroduced by sharing it naively.
 */
type RollbackFailureTrigger = {
	/** Completes "rolling back to savepoint "<name>" failed ${trigger}." -- must stay true for the calling path. */
	readonly trigger: string;
	/** The property name the thrown error carries `reason` under, and the key named in the message's own `Next:` clause. */
	readonly key: "callbackError" | "releaseError";
};

const POINTER_LABEL_BY_KEY: Record<RollbackFailureTrigger["key"], string> = {
	callbackError: "what the callback threw",
	releaseError:
		"the RELEASE failure this rollback was attempting to recover from",
};

const CALLBACK_THREW: RollbackFailureTrigger = {
	trigger: "after the nested transaction callback threw",
	key: "callbackError",
};

const RECOVERING_FAILED_RELEASE: RollbackFailureTrigger = {
	trigger:
		"while recovering from a failed RELEASE after the nested transaction callback returned normally",
	key: "releaseError",
};

/** Attempts `ROLLBACK TO SAVEPOINT "name"`, throwing the `savepoint-rollback-failed`-coded error (carrying both the rollback failure as `cause` and `reason` -- whatever triggered the rollback attempt, described truthfully per {@link RollbackFailureTrigger}) if that itself fails; resolves silently on success so both callers can layer their own outcome on top. */
async function rollbackOrFail(
	session: DriverSession,
	name: string,
	reason: unknown,
	{ trigger, key }: RollbackFailureTrigger,
): Promise<void> {
	try {
		await sendCompiled(
			session,
			savepointStatement("rollback to savepoint", name),
		);
	} catch (rollbackError) {
		throw Object.assign(
			new Error(
				`rolling back to savepoint "${name}" failed ${trigger}. Do not catch this error: if it escapes the enclosing callback the transaction rolls back, and if you catch it the transaction can still commit without the nested work. Next: inspect "cause" for the rollback failure and "${key}" for ${POINTER_LABEL_BY_KEY[key]} -- when the rollback failed because the connection itself is unusable, letting this error escape is also what gets that connection discarded.`,
			),
			{
				code: "savepoint-rollback-failed",
				cause: rollbackError,
				[key]: reason,
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
	await rollbackOrFail(session, name, callbackError, CALLBACK_THREW);
	// best-effort (#445 review B4): "rethrowing that error unchanged" is
	// this path's own contract (the modified requirement), so a failure on
	// this cleanup-only release must never replace or swallow the
	// callback's error -- unlike the release-failure path above, there is
	// nothing else here worth surfacing as its own error.
	await sendCompiled(
		session,
		savepointStatement("release savepoint", name),
	).catch(() => {});
	throw callbackError;
}

/** A statement error swallowed inside a nested callback leaves the subtransaction aborted, so the `RELEASE SAVEPOINT` that follows its normal return fails (#445 R2). Attempts `ROLLBACK TO SAVEPOINT` to recover -- surfacing `savepoint-release-failed` on success, or letting the existing rollback-failure path in {@link rollbackOrFail} take over if that recovery itself fails (carrying the release failure as `releaseError`, never mislabeled `callbackError` -- the callback returned normally here). */
async function recoverFromFailedRelease(
	session: DriverSession,
	name: string,
	releaseError: unknown,
): Promise<never> {
	await rollbackOrFail(session, name, releaseError, RECOVERING_FAILED_RELEASE);
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

/** Builds the `transaction` member a {@link Tx} carries — one savepoint per call, released on return and rolled back on a throw, guarded against a second nested transaction starting on this same `tx` while one is still in flight (#445/D1). `token` is this `tx`'s own place in `tree` -- restored as `tree.innermost` once the nested transaction settles, so the enclosing `tx` may send again (#449); the nested transaction's own fresh token is marked `settled` in the same step, so a caller that kept that handle is refused under its own code afterward (task 1.4), not silently allowed to send into the now-unbracketed enclosing transaction. `token.settled` is checked before the sibling guard (task 1.4b, lead R2): a settled handle starting a new nested transaction would otherwise send a real `SAVEPOINT` and, on its own release, restore `tree.innermost` to this already-settled token -- wrongly refusing the live parent's next statement instead of its own. */
const createSavepointApi = (
	session: DriverSession,
	tables: Declarations["tables"],
	tree: TransactionTree,
	token: TxToken,
): Tx["transaction"] => {
	const state = { active: false };
	return (async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
		assertNotSettled(token);
		if (state.active) {
			throwConcurrentNestedTransaction();
		}
		state.active = true;
		// Reassigned synchronously, before anything is awaited (#449): a
		// statement racing this call via `Promise.all` runs its own guard in
		// this same synchronous turn, so it must already see the nested
		// transaction's token, not the old one, by the time it checks --
		// this ordering (flip `innermost` before the SAVEPOINT is even sent)
		// is what actually closes the race, not merely having a token.
		const childToken: TxToken = {
			settled: false,
			kind: "nested",
			parent: token,
		};
		tree.innermost = childToken;
		try {
			const name = `hejbro_sp_${tree.next}`;
			tree.next += 1;
			await sendCompiled(session, savepointStatement("savepoint", name));
			// `Promise.resolve().then(...)` (#445 review B1), not a plain
			// `callback(...)` call: a callback that throws SYNCHRONOUSLY
			// throws immediately, before ever producing a promise for
			// `.catch` to attach to -- wrapping it inside a `.then` handler
			// normalizes that throw into this same chain's rejection, so
			// one `.catch` covers both a rejected promise and a synchronous
			// throw without a second, nested try (and without the `let`
			// that would otherwise be needed to carry the result out of it).
			const result = await Promise.resolve()
				.then(() => callback(buildTx(session, tables, tree, childToken)))
				.catch((callbackError: unknown) =>
					rollbackToSavepoint(session, name, callbackError),
				);
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
			childToken.settled = true;
			// Restore only what this call installed (D106 round 1, NB4): a
			// nested transaction the callback never awaited may still be in
			// flight and innermost; writing over it would leave the tree
			// pointing at a settled token and refuse the parent with a
			// message that is false. That floating transaction restores the
			// parent itself when it settles.
			if (tree.innermost === childToken) {
				tree.innermost = liveAncestor(token);
			}
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
	tree: TransactionTree = {
		next: 1,
		innermost: { settled: false, kind: "root" },
	},
	token: TxToken = tree.innermost,
): Tx => ({
	...createChainApi(
		// `async` (task 1.4, #449): a thenable whose own `.then` throws
		// synchronously is not a refusal, it is an escape -- a `Promise.all`
		// entry or any other direct `.then(f, r)` caller must see a
		// rejection, never an exception thrown out of calling `.then`
		// itself.
		() => async (send) => {
			assertInnermost(tree, token);
			return await send(session);
		},
		tables,
	),
	// executeOn's own runtime return is always the plain DriverRow shape --
	// this cast is ExecuteResult's compile-time-only narrowing of that same
	// value, never a distinct runtime reshape (same reasoning as db.ts's own
	// `executeImpl` cast).
	execute: (async (statement: CompileInput) => {
		assertInnermost(tree, token);
		return await executeOn(session, statement, tables);
	}) as Tx["execute"],
	transaction: createSavepointApi(session, tables, tree, token),
});

/**
 * Builds a fresh root `tx` and hands it to `callback`, marking the root
 * token settled once the callback has settled either way -- committed,
 * or rolled back on a thrown error (#449, task 1.4c review repair). The
 * one place a root {@link TransactionTree} is created, shared by every
 * site that opens a transaction and hands its callback a root `tx`:
 * `createTransactionApi` below, `db.ts`'s provider path
 * (`transactionWithProvider`), and `context.ts`'s scoped path
 * (`scopedTransaction`) -- so settling has one site, never three that
 * could drift apart on when they mark it. A caller who kept the handle
 * past this callback's own return is refused with
 * `statement-after-transaction` afterward, instead of quietly running
 * its next statement on whatever connection the pool hands out next,
 * outside any transaction.
 */
export const runCallbackWithTx = async <T>(
	session: DriverSession,
	tables: Declarations["tables"],
	callback: (tx: Tx) => Promise<T>,
): Promise<T> => {
	const token: TxToken = { settled: false, kind: "root" };
	const tree: TransactionTree = { next: 1, innermost: token };
	try {
		return await callback(buildTx(session, tables, tree, token));
	} finally {
		token.settled = true;
	}
};

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
 * The reentrant guard `db.transaction` has always carried (task 4.6),
 * generalized over *how* a transaction's own session gets opened
 * (add-context-provider): `open` is whatever opens one -- `driver
 * .transaction` directly for the unscoped path, or a registered
 * provider's own `providerRun` (which resolves/validates/applies the
 * context, then calls `driver.transaction` itself) for the provider path.
 * Either way, calling back into *this* built member while its own
 * transaction is still open takes a **second connection out of the
 * pool** -- the deadlock risk `nested-transaction-unsupported` exists to
 * catch is a property of "this member opened a transaction and got
 * called again", never of which opener it used, so one guard serves both
 * rather than one being silently unguarded (query-execution's own
 * "on the db handle" nested-transaction requirement is path-independent
 * the same way `rls-execution-context`'s role-validation requirement is).
 * `state` is one object per *built* member (per `createTransactionApi`/
 * provider-wiring call, not per invocation of the returned function) --
 * `const`-bound but its own field mutated, never reassigned.
 */
const guardNestedTransaction = (
	open: <T>(callback: (session: DriverSession) => Promise<T>) => Promise<T>,
): (<T>(callback: (session: DriverSession) => Promise<T>) => Promise<T>) => {
	const state = { active: false };
	return async <T>(
		callback: (session: DriverSession) => Promise<T>,
	): Promise<T> => {
		if (state.active) {
			throwNestedTransactionUnsupported();
		}
		state.active = true;
		try {
			return await open(callback);
		} finally {
			state.active = false;
		}
	};
};

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
 * The reentrant guard is {@link guardNestedTransaction} (shared with the
 * provider path, add-context-provider) -- a different `db()` handle's own
 * `transaction()` is a different member with its own `state` and is
 * deliberately not guarded against here (it is a different connection
 * pool entirely, not a nesting of this one).
 */
export const createTransactionApi = (
	driver: Driver,
	tables: Declarations["tables"],
): (<T>(callback: (tx: Tx) => Promise<T>) => Promise<T>) => {
	const guardedOpen = guardNestedTransaction(
		<T>(callback: (session: DriverSession) => Promise<T>): Promise<T> => {
			assertCapability(
				driver,
				["interactive-transactions"],
				TRANSACTION_OPERATION,
			);
			return driver.transaction(callback);
		},
	);
	return async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> =>
		guardedOpen((session) => runCallbackWithTx(session, tables, callback));
};

/**
 * Wraps a registered provider's own `providerRun` (`context.ts`'s
 * `createProviderRun`) with the exact same {@link guardNestedTransaction}
 * `createTransactionApi` uses -- built once per handle (add-context-
 * provider, task 1.2's re-work): a provider handle's `db.transaction`
 * is still "the db handle"'s own transaction member, so it keeps the
 * same nested-transaction guard, even though opening a session now goes
 * through the provider's own context resolution/validation/application
 * first, never a second, unguarded path.
 */
export const guardedProviderTransactionOpener = (
	providerRun: <T>(
		operation: string,
		send: (session: DriverSession) => Promise<T>,
	) => Promise<T>,
): (<T>(callback: (session: DriverSession) => Promise<T>) => Promise<T>) =>
	guardNestedTransaction((callback) =>
		providerRun(TRANSACTION_OPERATION, callback),
	);
