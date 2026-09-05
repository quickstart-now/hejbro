# @hejbro/supabase

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

- Updated dependencies [6e2c8ae]
- Updated dependencies [8d79eb0]
- Updated dependencies [6cbedf2]
- Updated dependencies [6ff7b7f]
- Updated dependencies [9e4fd05]
- Updated dependencies [a2ae603]
- Updated dependencies [419c8fa]
- Updated dependencies [700f71f]
- Updated dependencies [98e9965]
- Updated dependencies [30564a6]
- Updated dependencies [116e13f]
- Updated dependencies [31e951f]
- Updated dependencies [761567b]
- Updated dependencies [99b9554]
  - @hejbro/core@0.2.0-pre.2
  - @hejbro/query@0.2.0-pre.2

## 0.2.0-pre.1

### Patch Changes

- Updated dependencies [333dae8]
- Updated dependencies [b02443a]
- Updated dependencies [17f5495]
  - @hejbro/core@0.2.0-pre.1
  - @hejbro/query@0.2.0-pre.1

## 0.2.0-pre.0

### Minor Changes

- 33fe54d: `supabaseDriver(driver, options?)` takes an optional `endpoint`: `"session"`
  (the default — a direct connection or Supabase's session-mode pooler,
  unchanged behavior) or `"transaction-pooler"`, Supabase's transaction-mode
  pooler (Supavisor, port 6543). The pooler path declares
  `session-state: false` and carries its `IntervalStyle`/`bytea_output`
  pins transaction-locally with every execution instead of once per
  connection — measured against a local stack, the vanilla driver's
  once-per-connection pin does not reliably survive the pooler reassigning
  backend connections between transactions. An unrecognized `endpoint`
  value is rejected at construction with a coded error naming the
  recognized values, never silently downgraded to the session path.
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
- d15fee1: Supabase driver decorator and RLS execution context surface (#293
  group 6): `supabaseDriver(driver)` decorates any `@hejbro/query`
  contract `Driver` with Supabase's own contributed roles (`anon`,
  `authenticated`, `service_role`), so a schema with zero grants/policies
  still unlocks the new context builders. `asUser(claims)` (requiring a
  `sub` claim) and `asAnon()` build an RLS execution context — role
  `authenticated`/`anon` plus exactly one `request.jwt.claims` JSON
  session setting, matching Supabase's own RLS conventions (`auth.uid()`
  reads that same setting). Token verification stays with the
  application (supabase-js `getClaims`, Clerk `sessionClaims`, Auth0
  sessions, or `jose` against a custom JWKS) — this package never accepts
  or verifies a raw token itself.

### Patch Changes

- 7bbdc8b: Index declarations gain three capabilities they lacked: an access method (`index().using("gin" | "hash" | "gist" | "spgist" | "brin" | "hnsw" | "ivfflat")`, with `btree` the unchanged default), an operator class per column (`op(column, "jsonb_path_ops" | "gin_trgm_ops" | …)`, composable with `asc`/`desc`), and expression indexes (`.on(sql\`lower(${t.email})\`)`, requiring an explicit index name since there's no column to derive one from). Every invalid combination — an unknown method, `unique` on a non-B-tree method, an invalid operator-class identifier, an expression referencing another table or a subquery, an unnamed expression index — fails at declaration time with a message naming the fix. Expression columns are stored in the snapshot as structured nodes, so `--rename` retargets the identifiers inside them exactly like partial-index predicates and CHECK expressions already do. A 0.1.1 project that only uses B-tree indexes regenerates unchanged: the snapshot format stays 5, and the new fields are additive and absent by default.
- Updated dependencies [6b3cc7f]
- Updated dependencies [5aebe5c]
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
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
- Updated dependencies [1f459d1]
- Updated dependencies [e6c802c]
- Updated dependencies [2146480]
- Updated dependencies [f2e7781]
- Updated dependencies [70e68cc]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [387a2cc]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [dafb897]
- Updated dependencies [ef00b1b]
- Updated dependencies [0f19390]
- Updated dependencies [1aa05f2]
- Updated dependencies [71033ca]
- Updated dependencies [7bbdc8b]
- Updated dependencies [6345323]
- Updated dependencies [232293e]
- Updated dependencies [43bbebd]
- Updated dependencies [67ebf69]
- Updated dependencies [4be9551]
- Updated dependencies [d3c39bc]
- Updated dependencies [7c472b7]
- Updated dependencies [221d650]
- Updated dependencies [9394b37]
- Updated dependencies [b2be9b9]
- Updated dependencies [34afb30]
  - @hejbro/core@0.2.0-pre.0
  - @hejbro/query@0.2.0-pre.0

## 0.1.1

### Patch Changes

- 2ff02b7: `hejbro restore --help` documents the `<n>` positional; `hejbro --help` keeps each command on one line; `restore`'s undo hint notes that restored files are staged.
- 66117ac: Fix: a function declared `returns: <table>` failed at call time (`structure of query does not match function result type`) — or silently returned values under the wrong column names when the swapped columns share a type — once a column had been added to that table in the middle of its TypeScript declaration in a later migration. Snapshot column order is now the table's physical order: existing columns keep their order, new columns are appended, a renamed column keeps its position — the rule Postgres applies. `select(table)` / `.returning()` lists in function bodies and view definitions follow it. No snapshot format change; unchanged declarations render unchanged. Known limitation: a snapshot that already diverged from the database on 0.1.0 (a mid-declaration insert generated before this fix) is not repaired — hejbro has no database access by design; regenerate that table's functions by hand once, or drop and re-add the column.
- 1ebb306: `defineFunction` now takes the declared schema object as its first argument, like `table`/`defineView`/`grant` (#269) --
  `defineFunction(app, "archive_project", …)` instead of `defineFunction("app", "archive_project", …)`. The string form is still accepted on the 0.1.x line for compatibility (deprecated in JSDoc) and will be removed in 0.2.0.
- Updated dependencies [2ff02b7]
- Updated dependencies [66117ac]
- Updated dependencies [1ebb306]
  - @hejbro/core@0.1.1

## 0.1.0

### Minor Changes

- 2e125e8: Add Changesets-based release tooling: `.changeset/config.json` (a fixed
  version group across the three published packages, public npm access,
  `dev` as the base branch), root `changeset`/`version-packages`/`release`
  scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
  Introducing the release infrastructure itself is not a patch.
- e131220: `@hejbro/supabase` adds `authUidCached()`/`authJwtCached()` (#97) --
  the initPlan-cached form of `authUid()`/`authJwt()`, for use in RLS
  `using`/`withCheck` clauses (they render `(select auth.uid())`/
  `(select auth.jwt())`, which Postgres evaluates once per statement
  instead of once per row). `authUid()`/`authJwt()` are unchanged and
  remain the correct form inside a column `default`/`check` expression,
  where a scalar subquery is illegal.
  
  A new validator, `rls-uncached-auth-call` (part of
  `supabaseValidators`), warns when a policy calls the plain form where
  the cached one belongs. It does not look at column `default`/`check`
  expressions at all.
- 1b9d4fa: Every migration generated from now on records the hejbro version that
  wrote it: a `-- hejbro: <version>` line directly below `-- hejbro
  migration` (#229). `@hejbro/core`'s `renderBanner` takes the version as
  an optional third argument (`undefined` by default, so every existing
  call site and golden fixture is unaffected) and `parseBannerVersion`
  reads it back; the CLI reads its own `package.json` at runtime to supply
  the string, so core never touches the filesystem or knows its own
  version. Pre-#229 migration files (no version line) keep parsing
  unchanged.
- 58dcafa: The Supabase storage bucket kind's `alter` change now reports which
  fields actually changed (`"public changed"`, `"file size limit
  changed"`, `"allowed mime types changed"`) instead of an empty `notes:
  []`. Previously every bucket config change rendered a bare `-- ~
  supabase-storage-bucket <name> []` in the migration banner -- the only
  kind that emitted an empty notes list on an alter (#116).
- d5151ad: `@hejbro/core` re-exports `decodeExprNode` from its public index, paired
  with the already-public `renderExpr` — tooling outside the package can
  now render a declared column's default expression back to SQL text the
  same way core itself does, without reimplementing the expression codec.
  No behavior change: this is purely a new public export exposing
  existing, already-tested internal logic.
  
  (This capability is exercised by `scripts/check-declared-vs-catalog.mjs`,
  a private, non-published tool — #218 — which is why the fixed group's
  other two packages carry no code changes of their own here beyond the
  version bump their `.changeset/config.json` fixed grouping requires.)
- 51d4c20: `@hejbro/core` exports `someDeepExprNode`, a deep expression walker that
  descends into `exists(...)` subqueries (#141). `@hejbro/supabase` adds
  the `rls-cached-auth-outside-rls` validator, built on it: it errors
  when a column `default`, a CHECK, or a partial-index predicate calls
  `authUidCached()`/`authJwtCached()` — both render a scalar subquery,
  which Postgres forbids outside RLS.
- f27cbea: `hejbro` now records a table's primary key constraint name
  (`TableSnapshot.primaryKeyName`) and every unique column's constraint
  name (`ColumnSnapshot.uniqueName`) in the snapshot, matching Postgres's
  own naming convention exactly (`<table>_pkey`, `<table>_<column>_key`)
  — frozen now, pre-1.0, so a later feature never has to disagree with a
  name already committed to a user's database (#24/D68).
  
  `generateMigration` diffs a primary key as one table-level constraint
  (the set of `.primaryKey()` columns), replacing #137's silent gaps —
  adding a primary-key column to an existing table, and a composite
  primary key's partial drop — with real `add constraint`/`drop
  constraint ... primary key` emission. A column's own `.primaryKey()`
  flag flipping in place is folded into the same rule.
  
  `hejbro verify`/rename plans keep both names in step with a table or
  column rename (mirrors the existing index/foreign-key drift guard).
  
  UNIQUE constraint *emission* stays out of scope this wave — a changed
  `.unique()` flag still throws `unsupported-column-alter`, now with a
  reason (table-level, not expressible as a column alter).
- fb76507: Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
  `@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
  `test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
  now — no CI gate yet. `package.json` (a `devDependencies` entry and a
  new script) does change in all three published packages; `package.json`
  is always packed regardless of `files`, so D59's changeset rule applies
  literally here, not by analogy to a prior PR's precedent.
- 77120e7: `HejbroError` is now a real `Error` subclass instead of a plain object
  type. `code`, `message`, and `declaredAt` remain accessible the same way,
  but the CLI's `catch`-clause discriminator now checks `instanceof
  HejbroError` instead of duck-typing on "has a `code` and a `message`" —
  the old check misidentified any Node runtime error carrying a `.code`
  (e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125). A plain object
  literal shaped like `{ code, message, declaredAt }` no longer satisfies
  the `HejbroError` type; build `HejbroError`s via the `hejbroError`
  factory instead — this can break consumer code that constructed one by
  hand rather than through the factory, hence `minor`, not `patch`.
- 8b22258: `hejbro` now keeps a schema-wide `grant(schema).tables(...)` (one-shot
  `all-tables-privileges`) in step with tables added by a later migration
  (#121). Postgres's own `grant ... on all tables in schema ...` only ever
  covers the tables that exist when it runs — a table declared after that
  grant already existed silently ended up ungranted, a chain-vs-fresh
  asymmetry the local round-trip caught but golden tests can't (they never
  run real SQL). `hejbro generate` now re-issues the exact schema-wide
  statement right after `create table` for every standing
  `all-tables-privileges` grant already covering the new table's schema.
  
  Extension interface change (D78): `ObjectKind.emit` gains a third,
  optional, read-only parameter — the full snapshot the diff is generating
  *toward*. `siblingChanges` (D74) can't cover this case: it's the diff's
  own change list, and a standing grant unaffected by the new table never
  appears there. Additive and backward compatible — every existing `emit`
  implementation (10 across `@hejbro/core` and `@hejbro/supabase`) ignores
  it and needs no change; only `tableKind`'s `create` case reads it.
- aedffb6: Adds two new CLI commands (#130): `hejbro history` lists every migration
  with its commit, date, state (`ok`/`lost`/`rewritten`/`uncommitted`),
  recorded snapshot hash, and subject line, computed purely from git
  plumbing against `migrationsDir` — `--links`/`--no-links` add
  GitHub/GitLab URL columns (or OSC8 terminal hyperlinks) for the origin
  remote. `hejbro restore <n>` restores declaration files matching
  `config.entry`'s glob back to migration `<n>`'s recorded state, guarding
  against a dirty working tree, an out-of-range target, and a
  lost/rewritten history state, then verifying the restored declarations
  reload, their format version pre-checks, and re-serializing them
  reproduces migration `<n>`'s recorded snapshot hash — reporting a
  colorized file-diff and the exact `git`/`rm` commands to undo it.
  
  Both commands are read/git-only: `@hejbro/core` is unchanged, and
  `packages/cli/src/git.ts` is the only module that spawns git
  subprocesses.
- 84670f9: Every user-facing `HejbroError` now pairs its "why" with a "Next:"
  clause stating a concrete, executable action (spec §7) — 59 call sites
  across `@hejbro/core` and `@hejbro/supabase` gained one, either by
  adding the literal `Next:` marker to guidance that was already there or
  by authoring new guidance. Internal-invariant guards (unreachable by
  any user action, confirmed by direct reproduction for the two
  ambiguous cases) are left as-is. A new `scripts/check-next-marker.mjs`
  (wired into `pnpm check:next-marker` and CI) keeps this a checked
  invariant going forward instead of a one-time sweep.
- c9b8852: `registry.register()` now requires a namespace prefix (a hyphen) from
  every kind id it doesn't already own itself -- previously this was
  only advice inside `duplicate-kind`'s message, surfaced solely once
  two kind ids actually collided. A preset registering an unprefixed
  kind id now fails immediately with `preset-kind-needs-prefix` instead
  of silently succeeding until a future collision. `@hejbro/supabase`'s
  own kind (`supabase-storage-bucket`) already satisfies this and needs
  no change.
  
  This is a new registration-time check a preset could start failing
  under, hence `minor` rather than `patch`. It buys predictable preset
  kind ids and an earlier, clearer error -- it does not make
  `unknown-kind`'s classification sound (see #196/#199): the reverse
  direction, "a core kind id never carries a hyphen," can't be enforced
  the same way, so `unknown-kind` still states both possible causes
  rather than guessing from a kind id's shape.
- fe5c20c: `ObjectKind` gains an optional `requiredKeys?: ReadonlyArray<string>` —
  every built-in core kind (and `@hejbro/supabase`'s storage-bucket kind)
  now declares its own snapshot node's mandatory top-level keys.
  `parseSnapshot` takes an optional second argument, a plain
  `ReadonlyMap<string, ReadonlyArray<string>>` built by the new
  `requiredKeysByKind(registry)` helper — when given, a hand-edited or
  corrupted snapshot entry missing one of its own kind's required keys is
  now reported by kind and key name at parse time, before the diff engine
  crashes on the `undefined` field downstream instead. Omitting the second
  argument (every pre-#159 call site) keeps `parseSnapshot`'s prior
  behavior unchanged. Follow-up to #26/PR #152's deferred "option 3".
- adcb680: `rls.policy(...).using(...)`/`.withCheck(...)` now accept
  `Expr<"boolean"> | Expr<"unknown">` — the same union `check()` (D50) and
  partial-index `.where()` (D51) already adopted, so a raw `sql` template
  (e.g. `` sql`${t.status} <> 'done'` ``) can be used directly as a policy
  predicate. Adds a `literal(value: boolean)` helper so an intentionally
  permissive "allow every row" policy can be written as
  `.using(literal(true))` instead of a borrowed-meaning workaround like
  `isNotNull(someNotNullColumn)`.
- 1206fd5: A policy `using`/`withCheck` expression that references a table outside
  its own schema/table — including one buried inside a correlated
  `exists()` subquery, referencing neither the subquery's own `from`/joins
  nor the outer policy's table — is now rejected at **declaration time**
  (`rls-policy-foreign-column`), the same moment every other policy
  validation runs. Previously this specific shape (a foreign reference
  *inside* `exists()`) only surfaced later, at `hejbro generate` time
  (`foreign-column-ref`), as a side effect of rendering the policy's SQL
  (#160).
  
  Fixing this closed a gap, not a new rule: a *direct* out-of-table
  reference (not inside `exists()`) was already rejected at declaration
  time before this change. If your declarations pass today, this changes
  nothing for you — a policy an earlier `hejbro generate` already accepted
  was already valid under the old, narrower check too.

### Patch Changes

- 76e676e: Fix `hejbro verify`'s chain-linearity check (#129): a rollback that
  re-declares an earlier schema state was misclassified as
  `diverged-migrations` (a fork), because the old check grouped entries
  by parent value globally with no notion of position. `checkChain` now
  walks strict positional adjacency instead, so a rollback's own
  `current` returning to an earlier state satisfies the very next
  entry's `parent` immediately and never trips the fork check.
- 22e5766: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241's slice split. Ten
  `@hejbro/core` functions the ratchet-5 measurement found over the new
  threshold — `validateFormatVersion` (`snapshot/snapshot.ts`),
  `retargetColumnRef`/`retargetSelectNode` (`expr/retarget.ts`),
  `encodeLiteral`/`decodeLiteral`/`decodeProjection` (`expr/codec.ts`),
  `liftLiteral`/`renderLiteral` (`expr/literal.ts`), `recordReturn`
  (`plpgsql/body-context.ts`), `renderStatementLines`
  (`plpgsql/render-body.ts`) — are now built on a `.some()`/`.every()`
  over-an-array dispatch or a closed handler map instead of an `if`/`||`
  chain or a `switch`, mirroring the technique #154 PR2 and #241 already
  used elsewhere. Several (`encodeLiteral`, `decodeProjection`,
  `renderLiteral`, `renderStatementLines`) close a coverage gap no test
  could ever have closed the other way: their former `switch`'s `default:
  assertNever(...)` branch was structurally unreachable. The rest needed
  test coverage only, no code change (`decodeLiteral`'s malformed-input
  fallback, `liftLiteral`'s unsupported-JS-type fallback, `recordReturn`'s
  insert/delete-returning-query branches).
- ebea52a: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), closing out the `engine` +
  `kind/diff-helpers.ts` slice #249 started. `generateMigration`
  (`engine/generate.ts`, complexity 10 — the widest single split in this
  slice) splits into `resolveGenerateMigrationOptions`/`blockedResult`/
  `sortPredropStatements`, each answering one question the original
  function's own branches asked inline. Two functions that surfaced
  after #249 opened also clear: `validateRequiredKeys`
  (`snapshot/snapshot.ts`) splits out its own gap-detection question into
  `requiredKeyGapFor`; `findExprScopeViolation`'s `sqlTemplate` handler
  (`expr/walk.ts`) moves from an inline `if` inside a `.flatMap()`
  callback to a `.filter().map()` chain (previously untested — added a
  test using a `sql\`\`` template with an embedded foreign-column
  reference). `engine/duplicate-version-fix.ts`'s `orderGroupByChain`
  also gains a one-line comment naming why its root-count check exists,
  even though (like the `hasFork` check #249 already removed) it's
  subsumed by `walkGroup`'s own failure mode for the same inputs.
- 869376c: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242's slice
  split with the `engine` + `kind/diff-helpers.ts` slice. Twelve
  functions the ratchet-5 measurement found over the new threshold —
  `validateConfirmDropTarget`/`rewriteSequencesForRename`/
  `validateTableRenameTarget`/`validateColumnRenameTarget`/
  `residualTableAmbiguities`/`retargetTableFields`
  (`engine/rename-plan.ts`), `createOrDropDiff`
  (`kind/diff-helpers.ts`, shared by all 8 built-in kinds),
  `notNullWithoutDefaultWarnings` (`engine/core-validators.ts`),
  `resolveDeclarations` (`engine/generate.ts`), and
  `orderGroupByChain`/`parseVersionAsInstant`/`planDuplicateVersionFix`
  (`engine/duplicate-version-fix.ts`) — are now split into named helpers
  that each answer one question the original function's own branches
  asked inline, the same de-nesting/extraction technique #154 PR2 and
  #241/#242 already used. `orderGroupByChain` also drops a `hasFork`
  pre-check found to be fully redundant with checks already below it.
  Several needed test coverage only, no code change (a `--confirm-drop
  target: "table"` spec, the `"unix"` migration-prefix strategy, a
  single-member duplicate-version group).
- b2776c4: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242/#249/#253's
  slice split with the `packages/core/src/kinds` slice (①-B). Five
  built-in kinds' `emit` the ratchet-5 measurement found over the new
  threshold — `rls-kind`, `sequence-kind`, `schema-kind`, `grant-kind`,
  `trigger-kind` — each move their `"create"`/`"alter"`/`"drop"` switch
  case into its own named module-scope handler, dispatched through a
  mapped `EmitHandlers` type over `ChangeOperation` (the object-literal
  handler-map technique #154 PR2/#241 already used) so a missing case is
  a compile error instead of a `switch`'s `default: assertNever(...)` at
  runtime — each handler is then scored as its own independent function.
  `sequence-kind`'s `diff` is also converted to reuse the shared
  `createOrDropDiff` guard, matching the other built-in kinds that
  already use it. No array-of-predicates tricks; every extraction is
  covered by a red-first mutation (swapped/inverted dispatch, confirmed
  to fail the existing golden tests) proving it's genuinely load-bearing.
- 2d0a2bd: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154). The four `@hejbro/supabase`
  functions the ratchet-5 measurement found over the new threshold
  (`schemaOf`/`declaredAtOf` in `validators/schema-of.ts`,
  `childrenOfVariableArity` in `validators/rls-uncached-auth-call.ts`,
  `storageBucketKind.diff` in `storage/bucket-kind.ts`) are now built on
  `.some()`-over-an-array dispatch or a closed handler map instead of an
  `if`/`||` chain or a `switch`, mirroring the technique #154 PR2 already
  used across `@hejbro/core`. `@hejbro/core`'s `renderQuery`
  (`expr/render-sql.ts`) and `@hejbro/supabase`'s `storageBucketKind.emit`
  move from a `switch` with a structurally-unreachable `default:
  assertNever(...)` branch to the same handler-map technique, closing a
  coverage gap no test could ever have closed the other way. Six other
  functions (`retargetForeignKeyReferenceColumn`,
  `rewriteForeignKeysForRename`, `ambiguousTableRenameMessage` in
  `engine/rename-plan.ts`, `resolveEvent` in `dsl/define-trigger.ts`,
  `storageBucketKind.emit`'s invariant guard, `renderQuery`) needed test
  coverage only, no code change.
- b66c122: Internal readability refactor (#154 ratchet-5, no behavior change):
  `dsl/rls.ts`'s `assertClauseAllowed` and `dsl/table.ts`'s
  `resolveReferenceTarget`/`validateIndexPredicates` each split their
  independent rules/steps into their own named functions.
- fa49e8f: Internal readability refactor (#154 ratchet-5, no behavior change):
  `kinds/policy-kind.ts`'s `emit` now uses the established `dispatchEmit`
  handler-map pattern (`emitCreateChange`/`emitAlterChange`/`emitDropChange`)
  instead of an inline `switch`; `kinds/table-kind.ts`'s `diff` splits its
  four keyed-diff computation into `tableFieldDiffs`, and the emptiness/note
  checks that use them into `isEmptyTableFieldDiffs`/`tableFieldDiffNotes`;
  `kinds/table-kind-emit.ts`'s `sequenceForAddedColumn` splits its two
  compound conditions into `isMatchingSequenceCreate`/`sequenceOwnsColumn`.
- 836fa7b: Internal refactor, no behavior change: closes out #154's CRAP work
  (PR2/#210, PR3/#222) by splitting the three remaining violations that
  were never `switch`-over-closed-union walkers, so a handler map
  couldn't apply to them the way it did for PR2/PR3's conversions --
  `retargetProjection` (split by `projectionKind`, plus new test coverage
  for its previously-untested `"columns"` branch), `parseSnapshot` (split
  into five named validator steps), and the rename-target validator
  (split by table vs column target, plus a new table-target test for a
  previously-untested `unknown-rename-target` boundary). `pnpm check:crap`
  now reports zero violations across `@hejbro/core` and `@hejbro/supabase`.
- cdaa442: Internal refactor, no behavior change: lowers CRAP scores further (#154
  PR3, following PR2's #210). `renderTypeNode`'s 28-case `switch` over
  `TypeNode`'s `typeName` is now a type-closed handler map, same technique
  as PR2's `ExprNode` walkers. `view-kind.ts`, `function-kind.ts`,
  `enum-kind.ts`, and `table-kind-emit.ts`'s own `emit` — a
  `switch (change.operation) { "create" | "alter" | "drop" }` each opened
  with, deliberately left untouched by PR2 — now share one dispatch helper
  (`kind/emit-helpers.ts`'s `dispatchEmit`), with each operation's own body
  extracted into its own named function per kind.
- 63afd9c: `policy` and `trigger`'s `alter`/`drop` migration steps now emit a bare
  `drop policy`/`drop trigger` instead of `drop ... if exists` (D75) — an
  out-of-band removal of a policy or trigger hejbro still declares now
  fails loudly at the next `hejbro generate`/apply instead of silently
  being re-created. The `create` path is unchanged: a first-time create
  still emits the idempotent `if exists` guard, since there is no
  previous snapshot identity for drift to hide behind there. Matches
  `sequence`'s existing (#193) bare-drop behavior on the same two paths.
- 8261b88: `hejbro verify` gains a fifth check (#220): two migration files sharing
  the same version prefix are now a hard error, caught before the chain
  walk (chain order is undefined when versions collide) — Supabase
  applies migrations by this exact prefix, so a collision means one of
  them silently never runs. `Next:` gives a computed `mv` command per
  extra file rather than asking you to work it out. `diverged-migrations`'
  own `Next:` is rewritten the same way: one fully computed
  `rm ... && hejbro generate` option per candidate file, instead of prose.
- a854f21: Adding a `.primaryKey()` column to an existing table, or dropping a
  column out of a composite primary key while another column still
  declares `.primaryKey()`, now fails loudly with `unsupported-column-
  alter` instead of silently emitting incomplete SQL (#137).
  
  Both paths were real defects, not just missing features:
  
  - **Add path**: `renderColumnDefinition` (used for `add column`) never
    emitted a `primary key` clause -- that's a `create table`-only,
    table-level concern -- so `alter table … add column "x" uuid not
    null;` looked plausible while the constraint itself never appeared.
  - **Drop path**: dropping one column of a composite primary key drops
    the *entire* constraint on Postgres's side, with no warning
    (confirmed directly against a real Postgres) -- silently leaving any
    surviving `.primaryKey()` column without one, so a chain-built
    database and a fresh build of the same declaration disagree.
  
  This is a smaller, standalone fix -- `phase8-constraint-names` (#24)
  replaces this guard with the real `add constraint`/`drop constraint`
  emission for both paths. Landing the guard first means the silent
  corruption is closed even if `phase8-constraint-names` takes longer.
- aea1cf9: Internal refactor, no behavior change: lowers CRAP scores across
  several core walkers and kind-diff functions (#154). The create/drop/
  neither-exists guard every built-in `ObjectKind`'s own `diff` opened
  with (identical across all eight kind files that use it, differing
  only in the literal `kind` value, including `table-kind.ts`) is now
  one shared helper (`createOrDropDiff`, `packages/core/src/kind/
  diff-helpers.ts`). A new `familyOfTypeNode` lookup table replaces a
  type-family switch. `plpgsql`'s recording context now carries its
  state explicitly instead of through nested closures. Five other
  tree-walker switches (rename-retarget, the expression renderer,
  `codec.ts`'s encode/decode, a column-scope walker, and a general tree
  walker) are now type-closed handler maps instead of `switch`
  statements.
- 54c3394: The `unknown-kind` error no longer always suggests a missing preset,
  which was actively wrong for a snapshot written by a newer hejbro (a
  core kind this build predates, e.g. a future `sequence` kind, #23) --
  no preset could ever provide it, so the advice sent readers hunting
  for one that doesn't exist. The message now says so explicitly for any
  unrecognized kind id, alongside the original "check your presets"
  advice, since this build can't always tell the two causes apart
  (#196).
- 2cb855d: `hejbro verify --fix` (#220) automatically resolves a
  `duplicate-migration-version` collision it can actually order by chain
  history: it renames every "later" file in a resolvable group to a version
  after the directory's current latest (staggered a second apart for a
  3+-way collision), leaving migration content and the checked-in snapshot
  untouched, prints each `<before> -> <after>` rename, then continues into
  the normal five checks against the refreshed file listing.
  
  A group `--fix` can't safely reorder — a genuine fork (two migrations
  sharing the same parent snapshot), or a member with no readable
  hash-chain banner — is left untouched (`--fix` prints a `skipped: ...
  chain order undetermined, see Next` line for it, never silent), and
  `duplicate-migration-version`'s `Next:` offers one full `mv` option per
  group member instead ("assume this one is later; rename it; rerun
  verify") rather than a single confident guess, since hejbro genuinely
  doesn't know the order. Both the resolvable-group `(a) hejbro verify
  --fix` / `(b) mv ...` pick and the unresolvable-group per-member `mv`
  options are computed from the exact same chain-order check `--fix`
  itself runs, so the diagnostic text and what `--fix` actually does can
  never disagree.
- Updated dependencies [2e125e8]
- Updated dependencies [e131220]
- Updated dependencies [1b9d4fa]
- Updated dependencies [58dcafa]
- Updated dependencies [d5151ad]
- Updated dependencies [76e676e]
- Updated dependencies [51d4c20]
- Updated dependencies [f27cbea]
- Updated dependencies [22e5766]
- Updated dependencies [ebea52a]
- Updated dependencies [869376c]
- Updated dependencies [b2776c4]
- Updated dependencies [2d0a2bd]
- Updated dependencies [b66c122]
- Updated dependencies [fa49e8f]
- Updated dependencies [836fa7b]
- Updated dependencies [fb76507]
- Updated dependencies [cdaa442]
- Updated dependencies [02f5388]
- Updated dependencies [908e2f5]
- Updated dependencies [63afd9c]
- Updated dependencies [8261b88]
- Updated dependencies [77120e7]
- Updated dependencies [67b9670]
- Updated dependencies [a8430ea]
- Updated dependencies [8b22258]
- Updated dependencies [aedffb6]
- Updated dependencies [84670f9]
- Updated dependencies [a854f21]
- Updated dependencies [7391c48]
- Updated dependencies [c9b8852]
- Updated dependencies [fe5c20c]
- Updated dependencies [adcb680]
- Updated dependencies [1206fd5]
- Updated dependencies [626c57f]
- Updated dependencies [aea1cf9]
- Updated dependencies [75f2d0a]
- Updated dependencies [50ac657]
- Updated dependencies [54c3394]
- Updated dependencies [2cb855d]
- Updated dependencies [92f075b]
  - @hejbro/core@0.1.0
