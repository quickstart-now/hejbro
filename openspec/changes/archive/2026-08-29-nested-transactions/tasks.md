# Tasks: nested-transactions

One group — the counter, the member and the guard's message are one
mechanism. Estimates are pure work minutes (D88).

## 1. Savepoint-backed nesting

- [x] 1.1 (~9m) [design] `Tx.transaction` + `SavepointCounter` threaded
      through `buildTx`. The [design] part is the naming scheme: a
      monotonic counter shared by the whole `tx` tree, not nesting
      depth, because `ROLLBACK TO` leaves a savepoint alive and a
      depth-keyed name would be reissued while the rolled-back one of
      the same name still exists. Red:
      `packages/query/test/db/transaction.test.ts` — "brackets its
      callback with a savepoint and releases it" + "sibling and deeper
      savepoints get distinct names". Files:
      `packages/query/src/db/transaction.ts`, that test.
- [x] 1.2 (~6m) Rollback path: the callback's error is rethrown
      unchanged, and a rollback that itself fails surfaces as
      `savepoint-rollback-failed` carrying both facts. Red: same file —
      "a throwing nested callback rolls back to its savepoint and
      rethrows unchanged" (asserts `toBe(boom)`, identity not shape, and
      that the OUTER transaction still commits). Files:
      `packages/query/src/db/transaction.ts`, that test.
- [x] 1.3 (~8m) Live witness against a real postgres:17: the server
      keeps the enclosing transaction usable after an inner rollback,
      and commits exactly the rows outside the savepoint. Verified
      load-bearing by asserting the discarded row IS present, which
      fails. Files: `packages/pg/test/integration.test.ts`.
- [x] 1.4 (~5m) The db-handle re-entry error's message now names
      `tx.transaction(...)` instead of "#313 not supported yet"; the
      query-layer reference documents nesting. Changeset (D59, `minor`),
      task times, README badges. Files:
      `packages/query/src/db/transaction.ts`,
      `skills/hejbro/references/query-layer.md`, `.changeset/*.md`,
      `openspec/task-times.csv`, `README.md`.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` 0 of 1312 over CRAP 5.
- `pnpm --filter @hejbro/pg test:integration` 5/5 against a real
  postgres:17 (Docker), including the new witness.
