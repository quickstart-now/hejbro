# @hejbro/core

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
- 67b9670: Column defaults, CHECK expressions, partial index `where` predicates,
  and policy `using`/`withCheck` clauses are now stored in the snapshot
  as structured expression nodes (D67/D70) instead of pre-rendered SQL
  text. This is what lets a table or column rename retarget the
  identifiers inside these expressions exactly — including across
  tables, when a policy reaches another table through `exists()` —
  instead of leaving stale text behind. Rendered SQL output is
  unaffected: the same `renderExpr` produces the same text at emit
  time, now from a decoded node instead of a stored string.
  
  **No format-version bump.** `v5` was opened by #152 for this change
  (D68); a snapshot generated in the intermediate `dev` state between
  #152 and #153 is not supported — no published version ever produced
  such a snapshot. A committed snapshot containing any of these four
  fields as pre-rendered SQL text (the only shape any published version
  of `v5`, or any earlier format version, ever wrote) will fail with
  `error[malformed-snapshot-node]` when read by `hejbro generate` —
  confirmed by reading a real snapshot from immediately before this
  change. hejbro makes no snapshot-compatibility promise before 1.0
  (pre-publication, no migration path — see AGENTS.md/D65); this is the
  kind of churn that policy exists to allow while it's still free.
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
- 7391c48: New warning, `rls-unreachable-schema` (#203): fires when a policy's
  schema grants `usage` to none of the roles it targets. Postgres checks
  schema `usage` before RLS is even consulted, so such a policy can
  never run at all — the failure is `permission denied for schema`, not
  an RLS denial.
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
- 626c57f: `serial`/`smallserial`/`bigserial` columns are now modelled properly
  instead of passed through as an opaque type name (#23/D66). A new
  `sequence` object kind tracks the backing sequence explicitly — the
  `create sequence`, `alter sequence … owned by …`, and
  `alter table … set default nextval(…)` statements `pg_dump` itself
  produces for a native `serial` column (confirmed by direct comparison
  against a real Postgres: structurally identical, modulo the `::regclass`
  cast Postgres adds on its own read-back and the role-ownership statement
  hejbro deliberately skips, consistent with its role-agnostic stance
  elsewhere).
  
  **This closes five real defects, not a cosmetic change**:
  
  - `integer()` → `serial()` used to render `alter column … type serial;`,
    which Postgres rejects outright — `serial` is `create table`/
    `add column` sugar, never a real, storable column type. Closed
    structurally, not by a runtime guard: a `ColumnSnapshot` never stores a
    `serial`-family type past `serialize` time (it always decomposes to
    the real base type — `integer`/`smallint`/`bigint`), so the invalid
    path is unreachable from the generic type-alter path rather than
    merely rejected by one.
  - `serial()` → `integer()` used to silently omit both the `drop default`
    and the sequence drop, since hejbro never tracked that the column had
    a `nextval(…)` default in the first place.
  - A table or column rename left the sequence's name behind — Postgres
    does **not** rename a serial-owned sequence on its own (confirmed
    directly against a real Postgres, not assumed) — the same drift the
    existing index/foreign-key name guards already close for those two
    kinds; sequences get the matching guard.
  - Dropping a table or column with a serial-family column double-dropped
    the backing sequence: Postgres's own `owned by` link already cascades
    the sequence away, but the `sequence` kind's own `drop default`/
    `drop sequence` statements used to run afterward, against a target the
    cascade already removed. Fixed structurally: both statements now go
    out on the `predrop` stage, which always runs before every kind's
    `main`-stage statements (the same stage `policyKind`/`triggerKind`
    already use for their own drops, for the identical reason) — so they
    always clear *before* the cascade could possibly race them.
  - Adding a `serial`-family column to a table that **already has rows**
    used to fail outright: `add column … not null;` and a separate
    `set default nextval(…)` cannot work as two statements, because
    Postgres only backfills a `not null` column from a default present in
    the *same* `add column` statement (confirmed directly against a real
    Postgres). `ObjectKind.emit` now receives the diff's sibling changes
    (`siblingChanges`, D74) so the `table` kind can inline a serial
    column's default into its own `add column` statement when the owning
    sequence is a sibling `create` change in the same diff — closing this
    for both new and existing tables alike.
  
  Also: `serial`/`smallserial`/`bigserial` always imply `notNull` on the
  column, independent of primary-key status (confirmed via `pg_dump`:
  neither `.primaryKey()` nor `.notNull()` is needed for Postgres to make
  the column not-null when it's serial-family) — a separate, narrower fix,
  landed as its own commit since it holds regardless of the sequence work
  above.
  
  No format-version bump. This is harmless right now because `formatVersion`
  5 has never been published (all three packages are `0.0.0`; #179 is the
  first release), so no reader exists to be broken — **but that is not the
  reason of record.** The reason is **D73 (#196)**: `formatVersion` tracks
  field *shape*, not vocabulary; adding a core kind never bumps it, before
  or after publication. An older hejbro reading a snapshot with a kind it
  doesn't know fails on the kind itself, not on the format — confirmed
  directly (a merge-base checkout of this repo, from before this PR,
  fed a hand-built v5 snapshot with a `sequence` node: `parseSnapshot`
  succeeds, `generateMigration` throws `unknown-kind`) — and #196's
  `unknown-kind` diagnostic is what tells that older hejbro to upgrade.
  Fixing that diagnostic's wording for a core (vs. preset) kind is out of
  scope for this PR — filed separately.
  
  No existing declaration used `serial`/`smallserial`/`bigserial` in the
  first place (confirmed:
  `grep -rnE '\b(serial|bigserial|smallserial)\b' packages/core/test/golden/cases examples --include="*.ts"`,
  scoped to every golden case and example other than this PR's own new
  `sequence-lifecycle` case, returns no matches — the plain-substring form
  `grep -rn "serial" ...` over the same scope returns two, both
  `serialize`/`.serialize(` false positives from an unrelated preset-smoke
  fixture, which is exactly why the word-boundary form is the one that
  answers this question), so there is also no *committed* snapshot this
  change affects either way.
- 75f2d0a: Snapshot format version bumped to `5` (D68). This PR only moves the
  version marker — no snapshot shape changed yet, so every existing
  declaration renders an identical snapshot object graph, just under
  `formatVersion: 5`. The actual shape changes this version opens the
  door for (structured expression nodes, primary key/unique constraint
  names) land in later PRs of the same wave without needing their own
  version bump. A snapshot written by a prior build (`formatVersion`
  4 or older) is rejected with the existing `unsupported-snapshot-version`
  diagnostic, same as any other format bump.
- 50ac657: `Table`'s and a trigger's `new`/`old` row's hidden metadata keys
  (`tableMeta`, `triggerRowMeta`) now use `Symbol.for` instead of
  `Symbol()`. Two installed copies of `@hejbro/core` (a real, if rare,
  package-manager outcome — e.g. a version-conflict-driven nested
  install) used to mint two different symbols sharing the same
  description, so `isTable`/`getTableMeta` — and, downstream, a foreign
  key's `references.table` cross-check (the shape `@hejbro/supabase`'s
  `authUsers` is used in) — could silently disagree about a table's
  identity across that boundary, up to and including a raw `TypeError`
  instead of a diagnostic. `Symbol.for`'s global registry makes the
  identity survive being installed twice.
- 92f075b: A view's own query is now stored in the snapshot as a **structured
  `SelectNode`** (`ViewSnapshot.query`, reusing #110/D67's expression
  codec) instead of pre-rendered SQL text (`ViewSnapshot.selectSql`, D27's
  original shape). This is what lets a table or column rename retarget the
  identifiers inside a view's query exactly, the same way #110 already
  does for column defaults, CHECK expressions, partial index `where`
  predicates, and policy `using`/`withCheck` clauses.
  
  **This is not a defect fix.** `create or replace view` already resolves
  a renamed dependency correctly today (Postgres re-resolves the view body
  against current names at replace time, not against the names in the
  stored definition text), and a *column* change to a view's own query is
  already a single `drop`+`create` pair (D27's prefix rule), never two
  independent add/drop halves a rename heuristic could misread. Nothing
  here was broken. It's done now anyway because pre-1.0 is the only free
  moment to change a snapshot's shape (D65): after publication, doing this
  later would mean a real format-version bump plus a migration story
  hejbro doesn't have yet, and it changes how an *unchanged* view
  declaration renders in the snapshot even though it changes no emitted
  SQL — D65's own trigger condition for "must happen before 0.1.0, not
  after."
  
  **No format-version bump.** `formatVersion` stays `5` — D68 already
  opened this pre-publication wave's single version for exactly this kind
  of change ("a change that alters how an unchanged declaration renders"),
  and this is the same wave, not a new one. **v5 carries the view field as
  well; D68's single pre-publication bump is unchanged.**
  
  Breaking shape change, no compatibility shim, consistent with hejbro's
  no-snapshot-compatibility-promise-before-1.0 policy (AGENTS.md/D65) —
  but milder than #110's own equivalent note for the other four fields:
  confirmed by direct reproduction (a scratch snapshot with a
  `selectSql`-shaped view, read by this change's built CLI, not just
  reasoned about) that `hejbro generate` does **not** throw. `emit` only
  ever reads the *current* declaration's freshly-serialized `query`, never
  decodes the *previous* snapshot's view field on a normal (non-`--rename`)
  run — the old `selectSql` value is only ever compared as raw JSON
  (`sameJson`), never decoded. Since a `selectSql`-shaped node and a
  `query`-shaped node are never byte-identical even when nothing about the
  declaration changed, every existing view gets exactly one spurious but
  harmless `~ view … [view changed]` migration on the first `generate`
  after upgrading — re-emitting `create or replace view` with byte-identical
  SQL to what already exists, not a crash and not a real change. A `--rename`
  run *does* decode the previous view's field (`rewriteExpressionReferences`),
  so an old-format snapshot combined with a rename touching a view still
  fails with `error[malformed-snapshot-node]`, same as #110's other four
  fields.

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
- 02f5388: Internal: replaced ternary expressions with if/early-return helpers
  across `@hejbro/core` and `hejbro` (no behavior change), and added a
  CI check that cross-referenced diagnostic error codes actually exist.
- 908e2f5: README: install instructions and status reflect the published packages;
  stale phase framing removed.
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
- a8430ea: Test infrastructure: package tests resolve core from source; CLI
  subprocess tests check dist freshness (no runtime change).
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
