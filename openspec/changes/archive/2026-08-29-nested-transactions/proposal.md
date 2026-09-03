# Proposal: nested-transactions

## Why

`tx` has no transaction API at all, so nesting is a `tsc` error, and a
callback that reaches back to the outer `db.transaction(...)` gets
`nested-transaction-unsupported` — an error whose own text points at
#313. Parked deliberately at the v1 cut (owner decision, 2026-08-26);
this is the unparking.

Nesting is not an exotic want: a routine that runs inside a transaction
when its caller has one and opens its own when it doesn't, or an
outer transaction that needs one step to be able to fail without taking
the rest down, has no expression today. Drizzle nests via savepoints,
which is also what Postgres itself offers.

## What Changes

- **`Tx` gains `transaction`.** `tx.transaction(callback)` issues
  `SAVEPOINT`, runs the callback with a `tx` on the same session,
  `RELEASE SAVEPOINT` on return and `ROLLBACK TO SAVEPOINT` on a throw,
  rethrowing the error unchanged. One connection, one `BEGIN`.
- **Names come from a monotonic counter** shared by the whole `tx` tree
  of one transaction (`hejbro_sp_1`, `hejbro_sp_2`, …), not from nesting
  depth. `ROLLBACK TO` keeps a savepoint alive, so a depth-keyed name
  could be reissued while a rolled-back one of the same name still
  exists; a counter cannot.
- **The db-handle re-entry guard stays**, with a rewritten message. It
  is not the same situation: that call takes a *second connection* out
  of the pool, which is a deadlock waiting to happen, not a nesting.
- **No new capability.** A savepoint is only ever issued inside an
  already-open interactive transaction, whose capability the outer
  `transaction()` already asserted.
- **A rollback that itself fails** surfaces as `savepoint-rollback-failed`
  carrying the rollback failure as `cause` and the callback's own error
  as `callbackError` — the connection is in trouble at that point and
  neither fact should be swallowed.

## Capabilities

### Modified Capabilities

- `query-execution`: adds the savepoint-nesting requirement, and narrows
  the existing "nested transactions are rejected" requirement to the
  db-handle re-entry case it actually describes now.

## Impact

- **Affected code**: `packages/query/src/db/transaction.ts` (the whole
  change; `context.ts`'s `scopedTransaction` builds its `tx` through the
  same `buildTx` and gains nesting for free),
  `skills/hejbro/references/query-layer.md`,
  `packages/pg/test/integration.test.ts` (the live witness).
- **Breaking**: none. `tx.transaction` did not exist, so nothing could
  depend on it; the db-handle guard keeps its code, only its message
  changes.
- **Decision log**: no new row — this is the parked half of an existing
  owner decision landing as planned.

## Verification note

The claim that matters here cannot be made by a fixture driver: that the
*server* keeps the enclosing transaction usable after an inner rollback.
The live witness inserts a row, nests a transaction that inserts and
throws, then inserts again in the outer callback and commits — and
asserts the committed table holds exactly the two rows outside the
savepoint. Against a real postgres:17 it returns `['after', 'kept']`;
asserting `['after', 'discarded', 'kept']` fails, so the witness is
load-bearing rather than self-fulfilling.
