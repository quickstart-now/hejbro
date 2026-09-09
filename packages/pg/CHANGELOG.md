# @hejbro/pg

## 0.2.0-pre.2

### Minor Changes

- 8d79eb0: The driver capability set gains a fourth key, `batched-transactions`: a
  driver that declares it can run a pre-assembled list of statements as
  one transaction, in one round trip where possible, returning one row
  list per member. Every `Driver` now implements a mandatory `batch`
  member — a driver declaring the capability `false` still implements it,
  by refusing before sending anything, the same pattern `transaction`
  already uses on a non-interactive driver.
  
  `db.as(context)` picks a driver's declared capability to decide how it
  runs: `interactive-transactions` still wins where declared, otherwise a
  driver declaring `batched-transactions` runs the context and the
  caller's own statement as one batch. This makes `@hejbro/neon`'s HTTP
  path (`neonDriver(sql)`, built from a `neon()` query function) usable
  with `db.as(context)` for the first time — role and settings apply
  transaction-local to that one batch. `db.transaction(callback)` is
  unaffected and still requires `interactive-transactions`, since a
  callback is interactive by definition.
  
  A batch failure is reported as a batch: every member statement, in
  order, with a statement that the driver does not report which member
  failed — never naming only the caller's own statement, which may not
  have been the actual cause. A driver whose `batch` resolves the wrong
  number of row lists (fewer, more, or none) is refused with the new
  `batch-result-count-mismatch`, naming both counts, rather than silently
  handing a context statement's own rows back as the caller's.
  
  A multi-command `sql`-kind text (`select 1; select 2`, only reachable
  through the `sql` escape hatch) now resolves to the **last** command's
  rows — psql's own convention — instead of `undefined` or a crash.
  `@hejbro/pg` and `@hejbro/neon`'s own session-setup statement is itself
  multi-command, so this rule is exercised on every connection. `@hejbro/
  query` exports this fold itself as `lastRows(result)`. It also newly
  exports `preparedStatementName(sql)` — the prepared-statement naming
  rule `@hejbro/pg` and `@hejbro/neon` both call, so neither driver holds
  its own copy of it anymore.
- 6cbedf2: The driver capability set gains a third key, `prepared-statements`, and
  `pgDriver`/`neonDriver`'s session-oriented (`Pool`) path can now name
  every built statement (`select`/`insert`/`update`/`delete`/a set
  operation) it sends, so a connection parses and plans each distinct
  text once instead of on every execution:
  
  ```ts
  const driver = pgDriver(pool, { preparedStatements: true });
  ```
  
  Opt-in, defaulting to `false` — an existing caller's driver sends
  exactly what it always did. A `sql`-kind statement (the escape hatch, a
  context's own applied statements, a migration body) is always sent
  unnamed regardless of the option, since hejbro parses no SQL and a
  `sql`-kind text may carry more than one command. `@hejbro/supabase`'s
  `supabaseDriver` now refuses, at construction, a base driver that
  declares `prepared-statements: true` for its `"transaction-pooler"`
  endpoint — a name prepared on one pooled backend does not exist on the
  next one the pooler hands out for a later transaction. Every other
  existing driver (`@hejbro/nile`'s decorator, `hejbro`'s CLI paths) is
  unaffected and declares `false`.

### Patch Changes

- 5b86f88: `preparedStatements` is read as `=== true`, so a non-boolean value from an untyped caller never lands in the declaration; a driver's `capabilities` object is frozen (D106 round 1 of add-prepared-statements, N3).
- Updated dependencies [8d79eb0]
- Updated dependencies [6cbedf2]
- Updated dependencies [9e4fd05]
- Updated dependencies [98e9965]
  - @hejbro/query@0.2.0-pre.2

## 0.2.0-pre.1

### Patch Changes

- @hejbro/query@0.2.0-pre.1

## 0.2.0-pre.0

### Minor Changes

- aad5078: Fixes from an adversarial review of the day's nested-transaction and
  `hejbro baseline` merges (#445).
  
  A second nested transaction started on the same `tx` while the first is
  still in flight now fails fast with `concurrent-nested-transaction`,
  before any savepoint statement is sent — concurrent siblings used to
  interleave one `SAVEPOINT` sequence on a single connection, silently
  discarding one sibling's work or aborting the whole transaction
  depending on the interleaving. A `RELEASE` that fails after a swallowed
  statement error now attempts `ROLLBACK TO` and surfaces
  `savepoint-release-failed` advising rethrow over swallow, instead of a
  bare `query-execution-failed`. A synchronously throwing nested callback
  now rolls back like a rejected one, and a rolled-back savepoint is
  released too, so no savepoint outlives the nested transaction that
  created it on any exit path. `savepoint-rollback-failed`'s message no
  longer asserts a false outcome.
  
  `hejbro baseline` over declarations that load but export nothing now
  fails with `baseline-nothing-to-adopt` instead of reporting a false "no
  changes" success and writing nothing; `--rename`/`--confirm-drop` are
  dropped from its `--help` and refused pre-parse with
  `baseline-flag-not-applicable`, since a baseline diffs against an empty
  snapshot and has nothing to rename or drop. `parseBannerBaseline` joins
  `parseBannerHashes`/`parseBannerVersion` as a public parser for the
  `-- baseline:` banner marker, matching its own prefix only.
  
  `ctx.return()` inside a plpgsql function/trigger body now dispatches by
  brand before duck-typing, so a table with a column literally named
  `exprNode` no longer misroutes `ctx.return(ctx.new)` down the expression
  path.

### Patch Changes

- 94445e9: integration harness only: the container readiness probe asks over TCP (`pg_isready -h 127.0.0.1`) instead of the unix socket, closing the cold-start window where the image's temporary init server answers on the socket while the host pool's TCP path has no listener. No runtime behavior change.
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
- Updated dependencies [1f459d1]
- Updated dependencies [f2e7781]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [43bbebd]
  - @hejbro/query@0.2.0-pre.0
