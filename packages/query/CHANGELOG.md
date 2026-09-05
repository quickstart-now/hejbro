# @hejbro/query

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

- 9e4fd05: A nested read (`jsonArrayFrom`, `jsonObjectFrom`, `related`) projected inside a CTE body and read back through the CTE's column is revived — `bigint`, `timestamptz` and aggregate cells arrive as their declared types instead of the cast's text (D106 round 1 of harden-aggregate-vocabulary, B1).
- 98e9965: The scoped name-keyed handle (`createDb(conn).as(context)`) now refuses
  a lookup of a name the contract doesn't vendor with `unknown-contract-table`,
  exactly like the unscoped client already did — including `as` itself,
  looked up on the scoped handle, which never resolved to it silently
  before.
  
  A statement (or a nested transaction) issued beside an in-flight nested
  transaction on the same `tx` — or from any `tx` above it — is now
  refused with `statement-during-nested-transaction` before it is ever
  sent, instead of landing inside a savepoint bracket it never chose and
  silently rolling back with it. A nested `tx` kept past its own
  callback's return is refused the same way, under `statement-after-nested-transaction`,
  naming the enclosing `tx` as where the statement belongs. The `tx` a
  top-level `transaction()` callback itself received is refused the same
  way once that transaction has committed or rolled back — under
  `statement-after-transaction` — instead of quietly running its next
  statement on whatever connection the pool hands out next, outside any
  transaction.
  
  The repo-internal driver-conformance kit now classifies a transaction-control
  statement by the word it leads with once a semicolon glued to that word
  is stripped too, matching the driver-contract requirement's own wording
  exactly — including a savepoint rollback's optional `work`/`transaction`
  word, which now keeps the statement ordinary rather than ending the
  transaction. A comment glued to a control word (`commit-- x`) no longer hides it from the conformance kit, and a nested transaction the callback never awaited keeps the starting `tx` refused only while it is in flight — its settling restores the starting `tx`, never a stale one.
- Updated dependencies [6e2c8ae]
- Updated dependencies [8d79eb0]
- Updated dependencies [6cbedf2]
- Updated dependencies [6ff7b7f]
- Updated dependencies [a2ae603]
- Updated dependencies [419c8fa]
- Updated dependencies [700f71f]
- Updated dependencies [30564a6]
- Updated dependencies [116e13f]
- Updated dependencies [31e951f]
- Updated dependencies [761567b]
- Updated dependencies [99b9554]
  - @hejbro/core@0.2.0-pre.2

## 0.2.0-pre.1

### Patch Changes

- Updated dependencies [333dae8]
- Updated dependencies [b02443a]
- Updated dependencies [17f5495]
  - @hejbro/core@0.2.0-pre.1

## 0.2.0-pre.0

### Minor Changes

- ef12376: Catalog inference (#604): `hejbro import --schema <name> --out <dir>`
  reads a live database's catalog, read-only, and writes one starter
  declaration file per schema using the DSL's own builders — the
  introspection-assisted seeding half of #385 that hand-writing
  `table()` declarations previously left entirely manual. `--schema` and
  `--out` are both required with no default (a hosted Postgres's own
  platform schemas are schemas too, and adopting them by default is
  never wanted). A column whose SQL name no declaration key can
  round-trip is left out of the starter file and named in the loss
  report, which every file's own header also carries in full; two
  schemas whose tables reference each other never produce files whose
  imports form a cycle — the closing foreign keys go through an
  unexported reference-only handle instead. `import` never overwrites an
  existing file.
  
  `hejbro pull --db-url <db> --schema <name>` is the new database-sourced
  fallback for a vendored contract, for when the schema repository
  `link`/`vendor` need isn't reachable: it writes into the exact
  destination `hejbro vendor` does, marked with no commit, so `vendor
  --check`/`outdated` refuse to compare it against one (naming `link` as
  the way to a commit-anchored contract instead).
  
  `ContractOrigin`/`ContractMetadata` (`@hejbro/query`) are now a
  discriminated union on `source` — `"git"` (vendor's own, `commit`/
  `exportHash`) or `"database"` (pull's own, `database`/`schemas`) — so
  code that forgets the database-sourced case fails to compile rather
  than at run time. A contract a pre-#604 `hejbro vendor` already wrote
  and committed keeps type-checking unchanged after upgrading.
- 99b659e: `db(schema, driver, { context })` registers an execution-context
  provider: a resolver consulted once per execution, applied through the
  same `assertDeclaredRole`/`applyContext` mechanism `db.as(context)`
  already used — every thenable chain member, `execute`, `db.fn.*`, and
  `transaction(callback)` run under the resolved context automatically,
  so a call site no longer has to remember to wrap itself. An explicit
  `handle.as(context)` still always wins and never consults the
  resolver; a resolver that throws propagates its exact error and opens
  no transaction; a resolver that yields nothing (bypassing its
  non-nullable return type) fails closed with `context-provider-empty`
  before anything reaches the database. Registering a provider is an
  observable change on a handle that previously ran unwrapped: that
  execution now opens a wrapping transaction, though the statement's own
  SQL and parameters are untouched. The handle's existing
  `nested-transaction-unsupported` reentrant guard applies identically
  whether or not a provider is registered. `@hejbro/supabase` needed no
  new code for this: its existing `asUser`/`asAnon` context builders
  already produce the values a provider's resolver returns.
- 1f459d1: `@hejbro/query` exports `throwMissingCapability(capability, operation)`
  (#490): a driver constructs the contract's own missing-capability error
  by calling it, never by reproducing its message text, so every driver's
  refusal reads identically — `@hejbro/neon`'s HTTP driver now constructs
  it this way instead of carrying its own copy.
  
  `hejbro check` no longer hardcodes any preset's kind (#482):
  `@hejbro/supabase`'s storage bucket kind now declares that no catalog
  object backs it, stated once in `check`'s coverage-boundary section
  rather than silently reported as agreeing. A declared object of a kind
  this build does not recognize is now reported as **not compared**, with
  the reason — never as a false difference — and the run cannot exit `0`
  on the strength of a comparison that never ran.
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
- 32a8f11: A mutation chain that never calls `.returning()` now resolves to
  `ReadonlyArray<never>` instead of the table's row type. The runtime
  value was always an empty array (the statement carries no `returning`
  clause, and hejbro never adds one implicitly); the type now says so, so
  code that read rows off `await db.insert(t).values(row)` fails to
  compile where it previously compiled and read `undefined`. Call
  `.returning()` or `.returning({ … })` to get rows back. `.returning()`
  with no projection still resolves every declared column. The bare type
  names (`InsertFinal<T>`, `InsertChainFinal<T>`, `ReturningRow<T>`, and
  their update/delete counterparts) keep meaning every declared column;
  only the stage a chain sits at before `.returning()` carries the
  never-requested instantiation.
- 19e7aeb: A driver can now own how an execution context becomes statements: an
  optional `renderContext` on the driver contract turns a `DbContext`
  into an ordered list of compiled statements, replacing the query
  layer's own default (`set local role`, then one
  `select set_config($1, $2, true)` per setting) when a platform's own
  mechanism differs. The default rendering itself is now exported —
  `defaultContextRendering` (value) and `ContextRendering` (type), both
  from `@hejbro/query`'s public entry — so a driver that needs the
  ordinary statements plus its own can compose them rather than restate
  the sequence. `@hejbro/pg`, `@hejbro/supabase`, and `@hejbro/neon`
  contribute no rendering and keep today's exact statement sequence,
  pinned as regression tests. `DbContext.role` is now optional: a
  context naming none is admitted only on a driver that declares its
  platform role-less (`Driver.roleLessPlatform`) — a named role is still
  validated against the declared whitelist on every driver regardless. A
  driver can also declare a context mandatory (`Driver.contextRequired`):
  every execution surface (`select`/`insert`/`update`/`deleteFrom`/
  `with`/`fn`/`execute`/`transaction`) is then refused with
  `context-required` before anything reaches the database when no
  context was resolved; `handle.driver` (the schema-assertion path)
  stays uncontexted, unaffected. The capability gate is unchanged: a
  context still requires `interactive-transactions`, checked before any
  rendering or resolver runs.
- 16e1c92: A `contextRequired` driver now refuses an execution whose context
  rendering — its own contribution, or the default rendering — produces
  zero statements, with `context-rendering-empty`: the requirement is
  that an execution *applies* a context, not merely that it names one.
  The refusal fires after the rendering has run and before any
  caller-supplied statement is sent, inside the transaction the query
  layer already opened, and is drawn from the number of statements
  returned alone, never from reading or rewriting them. This closes a gap
  `db.as({})` and a driver's own empty-rendering contribution previously
  passed through silently.
  
  The `operation` a refusal names — `context-required`,
  `context-rendering-empty`, and `driver-missing-capability` alike — is
  now the caller's own surface (`db.execute`, `db.select`, `db.insert`,
  `db.update`, `db.deleteFrom`, `db.with`, `db.fn`), on the explicitly
  scoped path and the provider path alike, replacing the shared
  `"db.as"`/`"db.context"` placeholders those errors previously carried.
  `transaction` is the one exception, unchanged on purpose: the driver
  contract requires a driver's own thrower to raise the identical token
  for its own member.
- fec58f9: Pre-0.2.0 hardening of the query layer (the `harden-query-layer`
  change; the fixed group moves all six packages, and this one
  changeset covers the change's three landing PRs). Array columns of
  moded `bigint`/`numeric` and `interval` now convert element-wise to
  their declared read types, with `interval[]` and `numeric[]` arriving
  as raw Postgres array text through `@hejbro/pg`'s per-query override
  (`numeric[]` previously lost precision silently under pg's default
  float parse). Mutation builders accept the declared read types
  (mode-resolved `bigint`/`number`/`string`, structured `IntervalValue`,
  element-typed arrays) and lift them to canonical text bind parameters.
  `@hejbro/pg`'s checkout pin calls the driver value's own
  `setupSession` member, so decorator-wrapped hooks take effect.
  `Tx.execute` resolves `ExecuteResult` statement types like
  `db.execute`. Default numeric modes are structurally derived from a
  single constants module, and reading a negative interval no longer
  produces `-0` axis fields.
- 43bbebd: Thenable db-first chain surface, real packaging, and the `hejbro` facade
  (#293 group 7): `db.select(...)`/`db.insert(...)`/`db.update(...)`/
  `db.deleteFrom(...)` mirror core's own builder stages and delegate to
  them directly (no second statement vocabulary) — a chain is inert until
  awaited (no driver call happens while it's being built), and
  `.compile()` on any stage is a pure, byte-identical preview of
  `compile()`, never touching the driver. The chain surface is identical
  across the unscoped `db()` handle, a `db.as(context)` scoped handle, and
  `tx` inside `transaction()`, via one shared factory. `@hejbro/query` and
  `@hejbro/pg` are now real published packages (tsdown build, `dist`
  exports, LICENSE, README) rather than source-pointing internals, and the
  `hejbro` facade re-exports `db`, the chain types, and `@hejbro/query`'s
  dual-use `sql` (replacing the plain core `sql` re-export — one `sql`,
  still compatible with every existing fragment use).

### Patch Changes

- f2e7781: query-execution-failed now leads with the driver's own message, ahead of the parameterized SQL — the reason survives truncation in default views; a non-error cause is named, never interpolated. The full driver error stays on `cause`.
- Updated dependencies [6b3cc7f]
- Updated dependencies [5aebe5c]
- Updated dependencies [65936ca]
- Updated dependencies [9963d04]
- Updated dependencies [9f58667]
- Updated dependencies [e530909]
- Updated dependencies [27d5554]
- Updated dependencies [31c7ffd]
- Updated dependencies [5f8b97f]
- Updated dependencies [46b902c]
- Updated dependencies [28aec17]
- Updated dependencies [effda0a]
- Updated dependencies [e6c802c]
- Updated dependencies [2146480]
- Updated dependencies [70e68cc]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [387a2cc]
- Updated dependencies [dafb897]
- Updated dependencies [ef00b1b]
- Updated dependencies [0f19390]
- Updated dependencies [1aa05f2]
- Updated dependencies [71033ca]
- Updated dependencies [7bbdc8b]
- Updated dependencies [6345323]
- Updated dependencies [232293e]
- Updated dependencies [67ebf69]
- Updated dependencies [4be9551]
- Updated dependencies [d3c39bc]
- Updated dependencies [7c472b7]
- Updated dependencies [221d650]
- Updated dependencies [9394b37]
- Updated dependencies [b2be9b9]
- Updated dependencies [34afb30]
  - @hejbro/core@0.2.0-pre.0
