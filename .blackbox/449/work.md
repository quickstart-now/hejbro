# Work — quickstart-now/hejbro#449

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Statements beside or after a nested transaction are refused

_2026-09-04T16:00Z_

Built: `packages/query/src/db/transaction.ts` grows `SavepointCounter` into a shared
`TransactionTree { next, innermost: TxToken }`; every `Tx` in a tree carries its own
`TxToken { settled }`. `buildTx`'s chain-run factory and `execute` both call
`assertInnermost(tree, token)` before sending — `token.settled` picks
`statement-after-nested-transaction`, `tree.innermost !== token` picks
`statement-during-nested-transaction`. `createSavepointApi` flips `tree.innermost` to a
fresh child token *synchronously, before the SAVEPOINT is even sent* (closes a
`Promise.all` race window), marks that token `settled` and restores the parent's token
in the existing `finally`, and — after 1.4's own tree-wide design already covered the
grandparent case for free — also checks `token.settled` ahead of its own sibling guard
so a leaked, already-settled handle can't start a new nested transaction either. The
chain run factory became `async` so a synchronous guard throw becomes the promise's
rejection, not an escape through a bare `.then(f, r)` call.

Measured: 1.3 red was the three concurrent shapes (`execute`, a select chain, insert+with
chains) beside an in-flight sibling — 3 of 23 in `transaction.test.ts`; the four controls
(two concurrent `tx.transaction()`s, sequential settle, nested-callback's-own-tx, throw-
then-execute) were already green. 1.4 red was the `.then` sync-throw finding, and the two
settled-handle rows (released/rolled-back) — the grandparent row was already green,
confirming no gap. 1.4b (lead-ruled after I reported the leaked-handle gap) red was the
leaked handle silently succeeding at `transaction()` — 1 test. Each fix landed at 100%
green (23/23, 28/28, 29/29 respectively), 64 files / 958 tests package-wide by the end.
The Docker-gated live witness (`packages/pg/test/integration.test.ts`, real postgres:17)
confirms the same refusal and the nested transaction's own survival on a real connection
— 26/26 under `test:integration`, default suite (28/28) unaffected.

<a id="w2"></a>
## W2 — A transaction's own handle is refused after it settled

_2026-09-04T16:34Z_

Review repair (1.4c): the review found that a kept top-level `tx`, used after
`db.transaction` committed, ran its next statement on the next pooled connection,
outside any transaction, and committed it silently. `packages/query/src/db/transaction.ts`
gains `TxToken.kind: "root" | "nested"` and a shared `assertNotSettled(token)` that picks
`statement-after-transaction` for a settled root token or `statement-after-nested-transaction`
for a settled nested one — used both at the `execute`/chain-run guard and at the
`transaction()` member's own entry (a mid-task bug: that member's own settled check was
still hard-coded to the nested-only thrower from 1.4b; unifying both through
`assertNotSettled` fixed it). New exported `runCallbackWithTx(session, tables, callback)`
is the one site a root `TransactionTree`/`TxToken` is built and marked settled in a
`finally` — `createTransactionApi`, `db.ts`'s provider path (`transactionWithProvider`),
and `context.ts`'s `scopedTransaction` all now go through it instead of building three
independent root trees. `skills/hejbro/references/query-layer.md` documents the new
code.

Measured: red was the settled root handle silently leaking through on all four surfaces
(`execute`, a chain root awaited, `with`, `transaction()`) for both a committed and a
rolled-back root transaction — 2 of 31 tests in `transaction.test.ts`. After the fix:
31/31 in the file, 64 files / 965 tests package-wide, `@hejbro/skills` 5 files / 24 tests
(the doc's own code blocks still type-check), root `check-types` 18/18.

