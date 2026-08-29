# Proposal: fix-lifecycle-review

## Why

An adversarial review of the 2026-08-29 merges (#445) found one silent
data-loss path and a set of contract defects around the newly landed
nested-transaction and baseline features. The data-loss one decides the
shape of this change:

`await Promise.all([tx.transaction(a), tx.transaction(b)])` interleaves
savepoint SQL on a single connection. `ROLLBACK TO sp_1` also destroys
`sp_2`, so `b`'s already-resolved work is discarded with no error at all;
the other interleaving aborts the whole transaction with a `no such
savepoint`. The db handle guards exactly this shape with `state.active`.
`tx.transaction` — the member added by `nested-transactions` — has no
guard, so the mechanism that made nesting supported also made the
concurrent case silently lossy.

The rest are contract defects of the same vintage: error text that
asserts something false, a recovery path that gives up too early, a
no-op that should be an error, a duck-type that can misfire on a
user-chosen column name, a banner marker nobody can parse, and a turbo
cache input that still lets a stale PASS replay.

Fixes that change error text, error codes, exit codes and the public
export surface amend observable contracts, so they ride an OpenSpec
change (D87) rather than going in as a plain bug fix.

## What Changes

- **A second in-flight nested transaction on the same `tx` is
  rejected** with a coded error, before any savepoint SQL is sent —
  the same fail-closed shape the db handle's own re-entry guard has.
  Sequential nesting and sibling-after-sibling stay unaffected;
  concurrent siblings on one connection are not a thing Postgres can
  express, so refusing is the only honest answer.
- **A `RELEASE` that fails attempts `ROLLBACK TO` first** and surfaces
  `savepoint-release-failed`, advising rethrow over swallow (R2).
  Today a statement error swallowed inside a nested callback leaves the
  subtransaction aborted and `RELEASE` dies with a bare
  `query-execution-failed` and no recovery attempt at all.
- **A savepoint is released after it is rolled back** (nit): `ROLLBACK
  TO` keeps the savepoint alive, so a long transaction that retries in a
  loop grows its savepoint stack for the life of the transaction.
- **A synchronously throwing callback rolls back** (nit):
  `callback().catch(...)` never sees a throw that happens before the
  promise exists, so the savepoint is left open and the error escapes
  un-rolled-back.
- **`savepoint-rollback-failed` says what is true** (R1). Its message
  asserts "the enclosing transaction will roll back", which is false
  when the outer callback catches — the driver then commits. It becomes
  a conditional statement of both outcomes, with catching named as the
  thing not to do here.
- **`hejbro baseline` with nothing to adopt is an error**
  (`baseline-nothing-to-adopt`, D2), not `no changes — snapshot already
  matches your declarations` and exit 0. A baseline no-op is always a
  mistake: the guard directly above it has just confirmed the snapshot
  is empty, so "already matches" is also semantically empty.
- **`baseline` stops accepting `--rename`/`--confirm-drop`** (nit):
  there is nothing to rename or drop in a first migration. They vanish
  from its `--help`, and passing one is refused before argument parsing
  with `baseline-flag-not-applicable` — a hejbro-shaped error with a
  reason and a `Next:`, not a raw argument-parser dump.
- **`recordReturn` checks the brand before duck-typing** (R4). `isExpr`
  matches anything carrying an `exprNode` property, so a table with a
  column literally named `exprNode` makes `ctx.return(ctx.new)` take the
  expression path.
- **`parseBannerBaseline` is exported** (R5), alongside
  `parseBannerHashes`/`parseBannerVersion` — an apply tool currently has
  to string-match the `-- baseline:` line to tell a register-as-applied
  migration from a runnable one.
- **`packages/skills`'s turbo test inputs cover `packages/*/src/**`**
  (R3). #431 covered the skill documents but not the sources its snippet
  test type-checks against, so an API rename still replays a stale
  cached PASS — the same failure class as #430 and the likelier cause.
- **Docs catch up**: README's CLI list gains `baseline`/`history`/
  `restore`, AGENTS.md's "three published packages" becomes the actual
  five-package fixed group, and `transaction.ts`'s orphaned tsdoc (which
  still says `tx.transaction` is a `tsc` error) goes.

## Capabilities

### Modified Capabilities

- `query-execution`: the savepoint-nesting requirement gains
  concurrency, release-failure recovery and post-rollback release; the
  rollback-failure error's claim about the enclosing transaction is
  corrected.
- `cli-commands`: `baseline` fails on nothing to adopt, its flag surface
  is narrowed to the flags a first migration can use, and the banner
  marker it writes becomes machine-readable through an exported parser
  (the marker's only consumer is an apply tool, so it belongs to the
  command's contract, not to `snapshot-format`, which covers snapshot
  files only).
- `plpgsql-function-bodies`: `ctx.return()` dispatches on the trigger-row
  brand, so a user's own column name never changes what
  `ctx.return(ctx.new)` means.

Not covered by a delta, deliberately: R1 (a message that asserts
something false), R3 (turbo cache inputs) and the nits restore or
preserve already-specified behavior, so they ride this PR through the
plain cycle.

## Impact

- **Affected code**: `packages/query/src/db/transaction.ts`,
  `packages/cli/src/commands/generate.ts`,
  `packages/core/src/plpgsql/body-context.ts`,
  `packages/core/src/sql/migration-file.ts`,
  `packages/core/src/index.ts`, `packages/skills/turbo.json`,
  `skills/hejbro/references/query-layer.md`, `README.md`,
  `packages/cli/README.md`, `AGENTS.md`.
- **Breaking**: `hejbro baseline` on empty declarations now exits 1
  instead of 0, and `baseline --help` no longer lists two flags. Both
  are pre-1.0 corrections of behavior that had no legitimate use.
  `parseBannerBaseline` is additive.
- **Decision log**: no new row — every item is a defect against a
  decision already taken, and the delegated decisions are recorded in
  #445 itself.

## Verification note

The concurrency guard cannot be witnessed by asserting an error alone —
an error is what the *unguarded* code sometimes produces too. The red
test asserts the lossy ordering specifically: two concurrent siblings
where one rolls back and the other resolves, then a check that the
other's work survived. Against the current code that assertion fails by
data loss, not by error, which is what makes it load-bearing.
