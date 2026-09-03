# Adversarial spec-only evaluation — harden-verify-and-dsl

## Round 1

### Verdict

BLOCKING 0 / NON-BLOCKING 6 / OK 7

Every delta scenario in `cli-commands`, `function-declaration`,
`table-declaration` and `plpgsql-function-bodies` matches shipped behavior
on `dev@ef00b1b8`. Nothing contradicts the delta text. The six
non-blocking findings are one evidence-quality gap on the headline
scenario, two prose over-claims, one pre-existing hole in the surface this
change rewrites, one stale doc comment, and one out-of-scope follow-up
found while building fixtures.

### Blocking

None.

### Non-blocking

**NB1 — missing observer (evidence quality).** `packages/cli/test/loader-cycle.test.ts`
is the only shipped observer of the delta's headline scenario
("Declaration files, or two tables in one file, that reference each
other"). Its fixtures import `"hejbro"`, which jiti resolves through real
Node module resolution to `packages/cli/dist` → `packages/core/dist` —
**not** the source under test. The vitest `resolve.alias`
(`vitest.shared.ts`) only rewrites imports inside vitest's own module
graph; jiti is a separate loader and is unaffected. Measured: both cases
fail today on `dev` in this worktree —
`failed to load "src/a_app.schema.ts": Cannot read properties of undefined (reading 'id')`
— because `packages/core/dist/index.js:3720` still carries the pre-#669
eager fold (`foldColumnReferences(columnEntries)`, called inside
`table()`). The shipped **source** is correct: an equivalent fixture whose
`hejbro` shim re-exports `packages/core/src/index.ts` loads, generates and
verifies cleanly in both file orders (see Method). So this is a test that
measures `dist`, not `src`: it fails loudly on a stale build (no
false-green today) but would green a source regression whenever `dist`
happens to be built from a revision that has the fix. Unlike the
subprocess suites it carries no `assertBuiltCli`/dist-freshness guard, so
its failure text names an import problem instead of "stale build — run
`pnpm build --force`". AGENTS.md's claim that in-process package tests
"never go stale even run outside turbo" does not hold for jiti-loaded
fixtures. Note the same fixture shape is pre-existing (`loader.test.ts`,
`fixtures/basic`, `fixtures/ordering`); those pass because they don't
exercise the changed path.

**NB2 — over-claim.** Delta: "each `.references()` thunk runs exactly
once, not once per read." `memoizedForeignKeys`
(`packages/core/src/dsl/table.ts:1250-1266`) caches on success only
(`if (cache.current === null)`), so a first `foreignKeys` read that throws
leaves the cache empty and the next read re-folds. Measured: a thunk that
throws on its first read and succeeds afterwards runs **2** times (probe
`a-table.test.ts`, "a thunk that throws on first read"). Partial folds are
re-run too — `flatMap` evaluates thunks in order, so a later column's
throw re-runs the earlier columns' thunks on retry. Narrow (needs a
side-effecting thunk plus a failing first read), but the requirement prose
is unconditional.

**NB3 — over-claim (unobservable clause).** Delta requirement: the thunk
"is resolved exactly once, on the declaration's first consumption, **after
every declaration module has evaluated**". The last clause describes how
the CLI loader happens to consume declarations, not a property the DSL
enforces or that any scenario can observe: any consumer that reads
`foreignKeys` from inside a still-evaluating module (e.g. a module-scope
`getTableMeta(t).foreignKeys` in one half of a cycle) still resolves
mid-cycle and throws. The enforceable half — "never during `table()`",
"once per declaration" — is separately stated and verified.

**NB4 — follow-up (hole in the rewritten surface).** The delta widens
`ReturnableQuery` to `InsertFinal<Table, ReturningProjection | undefined>`
(and the update/delete twins). That union also admits the pre-`returning()`
stages (`InsertReturnable<T> = InsertFinal<T, never> & {…}`; `never` is
assignable to `ReturningProjection | undefined`), so
`ctx.return(insert(p).values(r))` — **no `.returning()` at all** —
type-checks (measured: `@ts-expect-error` on that line is reported unused
by `tsc`) and renders
`return query insert into "app"."posts" ("title") values ('x');`, which
Postgres rejects at call time. Pre-existing (the old `undefined` default
admitted it identically — this delta neither caused nor widened it) and
outside the added requirement's text, but it is the one shape
`ReturnableQuery` should not accept and no scenario names it. Sibling to
the specified `execute-expects-no-returning` guard, which covers the
mirror-image mistake.

**NB5 — drift (doc comment).** `foldColumnReferences`'s doc comment
(`packages/core/src/dsl/table.ts:1291`) still says "Exported so
`existing-table.ts` and `rls.ts` reuse the identical fold, rather than
re-deriving foreign keys a second way." Neither file uses it:
`existing-table.ts` always emits `foreignKeys: []` (line 40) and `rls.ts`
never mentions foreign keys. The only in-repo caller is
`memoizedForeignKeys` in the same file. The comment sits on the function
this change moved, so it reads as current when it is not.

**NB6 — follow-up (out of scope for this change).** Found while building
`verify` fixtures: `runInit` (`packages/cli/src/commands/init.ts:67`)
hardcodes `migrations/` and `hejbro.snapshot.json` and never reads an
existing config, while its own doc comment sells it as a safe "repair
missing pieces" command. With a config declaring
`migrationsDir: "db/migrations"`, `snapshotPath: "db/snap.json"`, `init`
reports `created migrations/` / `created hejbro.snapshot.json` and exits
0; the very next `generate` fails `snapshot-not-found` naming
`db/snap.json`. `init` has no requirement in `openspec/specs/cli-commands/spec.md`,
so this contradicts no spec — filing it as a follow-up, not a finding
against this change.

### Verified scenarios

- **cli-commands / A tip mismatch names the artifacts that disagree** —
  OK. `runCheck4` (`packages/cli/src/commands/verify.ts:552-576`) names
  `migrationPath(config.migrationsDir, tipEntry.fileName)` and
  `config.snapshotPath`, both config-relative and never absolute.
  Measured on a real 2-step chain: identity line
  `error[chain-tip-mismatch]: migrations/20260903000001_add_s201.sql`, body
  names that file and `hejbro.snapshot.json`; with
  `migrationsDir: "db/migrations"` / `snapshotPath: "db/snap.json"` the
  message follows the config exactly. The tip is the last **hash-bearing**
  entry (`readChainEntries` drops unbannered files), so a legacy
  `99999999999999_legacy.sql` sorting last is never named. Cause clause
  gone — the text states the disagreement and a restore step only
  (`test/verify.test.ts:408`, `:439`, incl. `not.toContain("which means")`).
- **cli-commands / (pre-existing, re-checked) unbannered file passes** —
  OK. A single migration rewritten with no banner: exit 0,
  `verify: 5 checks passed (1 migrations, …)`.
- **function-declaration / A usage-authority function reaching generate is
  refused** — OK. `resolveFunctionDeclaration`
  (`packages/core/src/engine/generate.ts:82-95`) throws
  `synced-function-declared` on `authority === "usage"`; measured message
  names the function fully qualified
  (`function "vendor"."search_posts" carries no migration authority …
  Next: declare it with defineFunction() …`) and nothing is produced (it
  throws, no `sql`/`snapshot` returned). Test:
  `packages/core/test/engine/function-authority-refusal.test.ts` (3 cases,
  green).
- **function-declaration / Ordinary declarations are untouched** — OK.
  `defineFunction`/`defineTrigger` never set `authority`; measured a
  schema with both (`generateMigration` → `errors: []`, emits
  `create or replace function "app"."total_posts"`,
  `"app"."touch_updated_at_fn"`, `create trigger`). A trigger's own
  synthesized function bypasses the guard structurally
  (`resolveNonTableDeclaration` returns
  `[input.functionDeclaration, input]`), matching the requirement's
  "never touched by this guard".
- **plpgsql-function-bodies / A projected returning is returned as the
  body's result** — OK. Type-checked with the repo's own compiler options:
  `insert/update/delete … .returning({ id: p.id })` all compile as
  `ctx.return` arguments. Rendered:
  `return query insert into "app"."posts" ("title") values ('x') returning "app"."posts"."id" as "id";`
  — projection preserved, never `returning *`, never the full row; the
  bare `.returning()` form still renders the explicit list
  (`returning "id", "title", "published_at"`). The list is byte-identical
  to what the query builder renders elsewhere (`compile(insert(p).values(r).returning({id: p.id}))`
  → `… returning "app"."r_posts"."id" as "id"`). Deterministic across
  repeated renders. A projection naming another table's column is refused
  with `foreign-column-ref` by the shared renderer. Test:
  `packages/core/test/plpgsql/render-body.test.ts:138`.
- **table-declaration / Declaration files, or two tables in one file, that
  reference each other** — OK (source), see NB1 for the observer. Real
  `loadDeclarations` over a genuine ESM cycle, core resolved from source:
  both files load in either alphabetical order, each declaration's
  `foreignKeys` is the edge it named, `generate` exits 0 emitting both
  `alter table … add constraint … foreign key …` statements (FKs are never
  inline in `create table`, so a cycle needs no ordering), and `verify`
  passes 5/5. Same-file mutual reference and self-reference: both fold
  correctly (`packages/core/test/dsl/references-fold.test.ts`, green).
  Byte-identical SQL and snapshot across repeated generation and across
  declaration order; mixed `.references()` + extras keeps canonical order
  (`a_owner`, `z_owner`). `@hejbro/query`'s relation derivation reads the
  lazily-folded getter at query time and compiles the correlated subquery
  correctly over a mutually-referencing pair.
- **table-declaration / The thunk is resolved exactly once, however many
  times a declaration's foreign keys are read** — OK for successful reads
  (memoized in `memoizedForeignKeys`; measured 1 call across 2 reads); see
  NB2 for the throwing-first-read exception.
- **table-declaration / table() itself never resolves a reference thunk** —
  OK. `table()` folds nothing: only `extrasForeignKeys` (already resolved)
  feeds `assertNoDoublyDeclaredReference`, `validateColumnRefs` and
  `validateDuplicateNames`; the fold moved into the `get foreignKeys()`
  getter (`table.ts:1395-1413`). Measured: a thunk that throws
  unconditionally does not run during `table()` (call count 0). Side
  effect, spec-silent and correctly re-pinned in the suite: the
  `foreign-column-ref` refusal for a CTE reference target now fires on
  first `foreignKeys` read rather than inside `table()`
  (`packages/core/test/dsl/cte-column-ref.test.ts:79`); no requirement
  claims declaration-time failure for that case — only the
  `.references()`+extras clash does, and that guard is still eager.
- **diagnostics (cross-check)** — OK. `chain-tip-mismatch`'s prose changed
  while its code did not, matching "Message prose may move, the code may
  not"; both new/changed messages carry a `Next:` line.
- **skills/hejbro (cross-check)** — OK, not drift.
  `references/dsl-cheatsheet.md:95-101` documents the deferred thunk and
  cross-file cycles; `references/function-builder-pitfalls.md:69-72`
  documents the projected `.returning({…})` form and that the rendered
  `return query` carries exactly that list;
  `references/polyrepo.md:56-62` documents the `synced-function-declared`
  refusal with its `Next:` step. No skill file describes `verify`'s
  message text, so nothing there went stale.

### Method

Context-free: read only `openspec show harden-verify-and-dsl --diff`
(which prints proposal prose ahead of the deltas — that prose was not used
as evidence; every claim below was re-derived from source, tests, or
measurement), the four main specs the deltas touch, and the named source
files. No `tasks.md`, no PR body, no git log, no `blackbox/`, no
`.agents/`. No repository file was modified except this report.

Static reading: `packages/cli/src/commands/verify.ts` (checks 1–4,
`readChainEntries`, `identityFromMessage`), `packages/cli/src/snapshot-file.ts`,
`packages/core/src/dsl/table.ts` (`memoizedForeignKeys`,
`foldColumnReferences`, `table()`), `packages/core/src/engine/generate.ts`,
`packages/core/src/plpgsql/body-context.ts`,
`packages/core/src/query/mutate.ts`, `packages/query/src/db/related.ts`,
`packages/core/src/kinds/table-kind-emit-sql.ts`, `packages/cli/src/loader.ts`,
`packages/cli/src/commands/init.ts`, the three skill references.

Measurement: `pnpm --filter @hejbro/core exec vitest run` over
`test/dsl/references-fold.test.ts`, `test/dsl/cte-column-ref.test.ts`,
`test/query/with.test.ts`, `test/plpgsql/render-body.test.ts`,
`test/engine/function-authority-refusal.test.ts` — 5 files, 32 tests, all
green. `pnpm --filter hejbro exec vitest run test/loader-cycle.test.ts` —
2 failed (stale `dist`, see NB1); `test/loader.test.ts` — 9 passed;
`test/verify.test.ts` — blocked by the dist-freshness guard, read only, as
instructed. No `pnpm build`, no `pnpm install`, no workspace-wide
`test`/`check-types` was run.

Adversarial probes ran in a throwaway harness under
`/private/tmp/hejbro-probe` (deleted afterwards; nothing written into the
repository): a vitest root aliasing `@hejbro/core`/`@hejbro/query` to their
sources, driving `runInit`/`runGenerate`/`runVerify`/`loadDeclarations`
from `packages/cli/src` in-process, plus a `node_modules/hejbro` shim that
re-exports `packages/core/src/index.ts` so jiti-loaded fixtures resolve to
source instead of the stale `dist`. Probes: `verify` on a corrupted tip in
a 2-step chain, on a corrupted non-tip (→ `broken-chain`, tip check
skipped), with a legacy unbannered file sorting last, with a nested
`snapshotPath`/custom `migrationsDir`, with a hand-edited snapshot (→
`snapshot-stale` + `chain-tip-mismatch`, both naming their artifacts), with
an emptied migrations directory (→ passes), with a missing snapshot (→
`snapshot-lost` naming the configured path), with an unbannered sole
migration (→ passes); `.references()` cycles across two files in both
alphabetical orders, in one file in both declaration orders,
self-reference, thunk read twice, thunk throwing on first read, mixed
`.references()`+extras ordering, generate determinism (SQL and snapshot
bytes), relation derivation through `db().select().related()`;
`ctx.return` with projected `returning` on insert/update/delete, bare
`returning`, no `returning`, a foreign column in the projection, render
determinism, and a `tsc --noEmit` type-check of all of those under the
repository's own `tsconfig.base.json` options; `generateMigration` over a
hand-built `authority: "usage"` function and over a
`defineFunction` + `defineTrigger` schema.

## Round 1 disposition

- **NB1** — closed. `packages/cli/test/loader-cycle.test.ts` gained the
  same `assertBuiltCli` `beforeAll` guard the subprocess suites carry
  (`71d2b2a4`); `AGENTS.md`'s "never go stale" claim now names the
  jiti-fixture exception (`71d2b2a4`).
- **NB2** — closed. Pinned the reviewer's own measurement — a thunk
  throwing on its first `foreignKeys` read then succeeding runs 2
  times, not 1 (`b7b59388`) — and narrowed the delta's "exactly once"
  text and its scenario to the success-only-cache behavior that is
  actually true, adding a throw-then-refold scenario observed by that
  same test (`9375f842`). Follow-up (lead review, same round): the
  "resolves whichever file the loader reaches first" causal clause was
  attached to the throw-then-refold sentence, over-attributing to
  caching what the never-resolve-during-`table()` deferral alone
  provides — moved to the deferral sentence, same commit as this
  disposition update.
- **NB3** — closed. Dropped the delta's unobservable "after every
  declaration module has evaluated" clause (`9375f842`, same commit as
  NB2's text narrowing — both are the same paragraph).
- **NB4** — out of scope for this round, tracked as #686. Not touched.
- **NB5** — closed. `foldColumnReferences`'s doc comment no longer
  claims `existing-table.ts`/`rls.ts` reuse it; names the actual sole
  caller, `memoizedForeignKeys` (`3b133a39`).
- **NB6** — out of scope for this round, tracked as #687. Not touched.

## Round 2

### Verdict

BLOCKING 0 / NON-BLOCKING 6 / OK 8

All eight delta scenarios (`cli-commands` 1, `function-declaration` 2,
`plpgsql-function-bodies` 1, `table-declaration` 4) match shipped
behavior on `dev@851e51b9`. Nothing contradicts the delta text. The
round-1 correction did narrow the fold requirement to what
`memoizedForeignKeys` actually does — first *completed* read cached, a
throwing read caches nothing, never during `table()` — and each of those
three clauses now has its own observer. The causal attribution is also
right: "resolve under either file order" now hangs off the
never-during-`table()` deferral sentence, not the cache sentence, and
that is the true cause (caching is irrelevant to a cycle). The six
non-blocking findings are one rule-vs-repo gap the new AGENTS.md sentence
opens, two wording imprecisions in the delta text itself, three missing
observers for clauses the requirements state more broadly than their
scenarios, and one stale justification left in the comment round 1
already touched.

### Round-1 findings re-checked

- **NB1 (missing observer / dist-measuring test)** — **closed**, with a
  residual (R2-NB1 below). Measured: `pnpm --filter hejbro exec vitest run
  test/loader-cycle.test.ts` on the current tree fails with
  `@hejbro/core's dist/ is older than its src/ (stale build) — Next: run
  `pnpm build --force``, from `assertFreshBuild` via the new
  `beforeAll(assertBuiltCli)` (`loader-cycle.test.ts:14`) — the stale
  build is now named as a stale build, and both cases report as skipped
  rather than as an import failure. The false-green direction is closed
  too: a source regression either predates the build (guard fires) or is
  built into `dist` (the assertions fail). "Passes on a fresh build" was
  verified indirectly (no `pnpm build` was allowed): the same two fixtures,
  copied to `/private/tmp` with a `node_modules/hejbro` shim re-exporting
  `packages/core/src/index.ts`, load through the real
  `loadConfig`/`loadDeclarations` in both file orders and produce exactly
  the foreign keys the shipped test asserts. AGENTS.md's new sentence
  (lines 51–55) is accurate, including "via real Node module resolution":
  `hejbro` is unresolvable from the fixture directory by ordinary
  lookup (there is no `node_modules/hejbro` anywhere in the workspace) —
  it resolves through Node's *self-reference* rule off
  `packages/cli/package.json`'s own `name` + `exports`, i.e. to
  `packages/cli/dist`.
- **NB2 (over-claim: "exactly once")** — **closed**. The delta now reads
  "The declaration's first `foreignKeys` read that completes SHALL be
  cached … a read that throws SHALL cache nothing, so the next read folds
  again", which is exactly `memoizedForeignKeys`
  (`table.ts:1250-1266`: `if (cache.current === null)`, assignment after
  the sort, so a throw never reaches it). Re-measured independently:
  throw-once-then-succeed → 2 thunk calls, third read → still 2 (cached);
  always-throws → 3 calls over 3 reads, each re-throwing; two reference
  columns where the second throws → retry re-runs *both* thunks
  (`["a","z","a","z"]`), which is what the added scenario's "re-runs every
  `.references()` thunk" claims. Observer:
  `references-fold.test.ts:85`.
- **NB2 follow-up (causal attribution)** — **closed**. "this is what lets
  a reference into another declaration file (or another table in the same
  file) resolve …" now sits on the never-during-`table()` sentence. That
  is the correct cause: memoization plays no part in a cycle loading, and
  measured, a table whose thunk throws unconditionally still constructs
  (0 calls during `table()`).
- **NB3 (unobservable "after every declaration module has evaluated")** —
  **closed**. The clause is absent from the delta paragraph; what remains
  ("never while `table()` runs", "first completed read cached", "a
  throwing read caches nothing") is observable and observed.
- **NB4 (`ReturnableQuery` admits a mutation with no `.returning()`)** —
  **still open by disposition** (deferred to #686), unchanged and not
  regressed. Re-measured with `tsc --noEmit` under the repo's own
  compiler options: `@ts-expect-error` on
  `ctx.return(insert(posts).values({…}))` is reported *unused*
  (`TS2578`), and the same body renders
  `return query insert into "app"."posts" ("published_at") values (now());`
  — no `returning`, rejected by Postgres at call time.
- **NB5 (stale doc comment)** — **closed**, with a residual (R2-NB6).
  `table.ts:1291` no longer claims `existing-table.ts`/`rls.ts` reuse the
  fold; `memoizedForeignKeys` is indeed the only caller (repo-wide grep:
  the only non-comment hit outside the definition is `table.ts:1261`).
- **NB6 (`runInit` ignores a configured `migrationsDir`/`snapshotPath`)** —
  **still open by disposition** (deferred to #687), untouched:
  `commands/init.ts:67` still builds its artifact list from the
  `MIGRATIONS_DIR_NAME`/`SNAPSHOT_FILE_NAME` constants and never reads a
  config.

### Blocking

None.

### Non-blocking

**R2-NB1 — rule stated repo-wide, applied to one file.** AGENTS.md's new
sentence generalizes ("an in-process test whose fixtures import `"hejbro"`
and load through jiti … *needs* the same `assertBuiltCli`
dist-freshness guard"), but `packages/cli/test/loader.test.ts` is exactly
that shape — in-process, `loadDeclarations` over
`test/fixtures/basic` and `test/fixtures/ordering`, whose modules import
from `"hejbro"` — and carries no `assertBuiltCli` (it is absent from the
30-file grep of guard users). So the documented rule has one compliant
instance and one standing violation; a reader who trusts the sentence
will assume `loader.test.ts` measures source. Round 1 already noted those
fixtures pass only because they don't exercise the changed path, so this
is a latent gap rather than a live false green — but the sentence, as
written, promises otherwise. Either guard `loader.test.ts` too or scope
the sentence to the test that has the guard.

**R2-NB2 — delta wording, two imprecisions in the sentences round 1
rewrote.** (a) "this is what lets a reference into another declaration
file (or another table in the same file) **resolve whichever one the
loader reaches first**" — read literally, the reference resolves *the
file the loader reached first*, which is not what happens; the intended
claim is "regardless of which one the loader reaches first" (which is
what the scenario says: "under either file order"). (b) The scenario
heading "**The thunk resolves once per successful read**, not once per
read" states the opposite of its own THEN ("each `.references()` thunk
runs exactly once, cached after the first successful read"): once *per*
successful read would mean re-folding on every read. Both are prose-only;
the requirement body and the scenario body are both correct and both
match shipped behavior.

**R2-NB3 — missing observer: the "and generate" half of the headline
scenario.** `table-declaration`'s cycle scenario says the declarations
"load **and generate** under either file order … and the emitted foreign
keys are the ones each declaration named". `loader-cycle.test.ts` asserts
only the loaded `foreignKeys`; `references-fold.test.ts` never calls
`generateMigration`. No shipped test generates from a cycle. Measured
green in a probe: over both repo fixtures resolved against source,
`generateMigration` returns `errors: []` and emits both edges —
`alter table "app"."authors" add constraint "authors_latest_comment_id_fk"
foreign key ("latest_comment_id") references "blog"."comments" ("id");`
and the mirror for `"blog"."comments"` — with the two file orders
producing byte-identical SQL.

**R2-NB4 — missing observer: the trigger half of "Ordinary declarations
are untouched".** The scenario's WHEN is "a schema whose functions come
from `defineFunction` **and trigger definitions**";
`packages/core/test/engine/function-authority-refusal.test.ts:64` covers
only a `defineFunction` schema. Measured green in a probe: a schema
carrying both a `defineFunction` and a `defineTrigger` generates with
`errors: []`, emitting `create or replace function "app"."total_posts"`
and `create trigger` — the trigger's synthesized function bypasses the
guard structurally (`resolveNonTableDeclaration`, not
`resolveFunctionDeclaration`), so the requirement's "never touched by
this guard" holds; it is simply unpinned.

**R2-NB5 — missing observer: the update/delete half of the projected
returning.** The requirement is stated for "a mutation whose chain ends in
`.returning()` with a projection", and `ReturnableQuery`
(`body-context.ts:97-101`) widens all three stages
(`InsertFinal`/`UpdateFinal`/`DeleteFinal`), but the scenario and the only
test (`render-body.test.ts:139`) name `insert` alone. Measured green in a
probe: all three type-check under the repo's compiler options, and all
three render the projection verbatim —
`… update "app"."posts" set … returning "app"."posts"."id" as "id";`,
`… delete from "app"."posts" where … returning "app"."posts"."id" as "id";`
— never `returning *`, while the bare form still renders the explicit
list `returning "id", "title", "published_at"`.

**R2-NB6 — residual drift in the comment round 1 fixed.**
`foldColumnReferences`'s doc comment (`table.ts:1291`) now reads
"Exported for `memoizedForeignKeys` (**this file**) — its only caller".
The claim is true, but it justifies the `export` keyword with a
same-file caller, which needs no export; nothing outside `table.ts` (or
outside the package — it is not re-exported from `src/index.ts`) uses the
symbol. The comment reads as if the export were load-bearing when it is
now vestigial.

### Verified scenarios

- **cli-commands / A tip mismatch names the artifacts that disagree** —
  OK. `runCheck4` (`verify.ts:552-574`) builds the message from
  `migrationPath(config.migrationsDir, tipEntry.fileName)` and
  `config.snapshotPath`. Measured on a real 2-migration chain whose tip
  banner `snapshot:` line was rewritten:
  `error[chain-tip-mismatch]: migrations/20260903000002_add_audit.sql` /
  `… the migration chain's tip hash doesn't match the current snapshot —
  "migrations/20260903000002_add_audit.sql"'s "snapshot:" hash and the
  snapshot at "hejbro.snapshot.json" disagree. Next: restore …`. With
  `migrationsDir: "db/migrations"`, `snapshotPath: "db/snap.json"` the
  message follows the config exactly (`db/migrations/…`, `db/snap.json`),
  both config-relative. Observation only — no cause asserted, and the
  round-1 `not.toContain("which means")` shape still holds. The tip is
  the last *hash-bearing* entry (`readChainEntries:283-294` drops
  unbannered files): with a `99999999999999_legacy.sql` sorting last, the
  named artifact is still the real tip and the legacy file is never
  mentioned. Test: `packages/cli/test/verify.test.ts` (read only —
  dist-freshness guard).
- **cli-commands / (pre-existing, re-checked) an unbannered file passes
  and is counted** — OK. Intact chain plus an unbannered file: exit 0,
  `verify: 5 checks passed (2 migrations, snapshot sha256:002630eee076…)`.
  Empty migrations directory: no tip, `chain-tip-mismatch` never fires.
  Missing snapshot with prior migrations: `error[snapshot-lost]:
  db/snap.json`, naming the configured path and skipping checks 2 and 4.
- **function-declaration / A usage-authority function reaching generate is
  refused** — OK. `resolveFunctionDeclaration`
  (`engine/generate.ts:84-95`) throws on `authority === "usage"`.
  Measured: code `synced-function-declared`, message
  `function "app"."vendored_fn" carries no migration authority … Next:
  declare it with defineFunction() …`, and nothing is returned (it
  throws — no `sql`, no `snapshot`). Test:
  `test/engine/function-authority-refusal.test.ts:32,47` (green).
- **function-declaration / Ordinary declarations are untouched** — OK
  (see R2-NB4 for the observer gap). Measured:
  `defineFunction` + `defineTrigger` schema → `errors: []`, function and
  trigger both emitted.
- **plpgsql-function-bodies / A projected returning is returned as the
  body's result** — OK (see R2-NB5 for the observer gap).
  `ReturnableQuery` (`body-context.ts:97-101`) admits
  `ReturningProjection | undefined` on all three mutation members;
  `insert(posts).values({…}).returning({ id: posts.id })` compiles under
  the repo's own compiler options and renders
  `return query insert into "app"."posts" ("published_at") values (now())
  returning "app"."posts"."id" as "id";` — the projection, never `*`,
  never the full row. Test: `test/plpgsql/render-body.test.ts:139`
  (green), which asserts the rendered list, not just compilation.
- **table-declaration / Declaration files, or two tables in one file, that
  reference each other** — OK. Cross-file: the two repo fixtures, resolved
  against source, load in both alphabetical orders with each declaration's
  `foreignKeys` exactly the edge it named, and generate identically (see
  R2-NB3). Same-file: mutual reference in both declaration orders and in
  both *read* orders, plus a self-reference, all fold correctly. Tests:
  `packages/cli/test/loader-cycle.test.ts` (cross-file, guarded),
  `packages/core/test/dsl/references-fold.test.ts:15` (same-file).
- **table-declaration / The thunk resolves once per successful read, not
  once per read** — OK on the body's claim (see R2-NB2b on the heading).
  Measured: 3 successful reads → 1 thunk call, and all three reads return
  the *same array identity* (the cache is the value, not a re-sort).
  Test: `references-fold.test.ts:61`.
- **table-declaration / A read whose thunk throws caches nothing** — OK.
  Measured: throw-then-succeed → 2 calls; always-throw → 3 calls over 3
  reads, every read re-throwing; a two-column table whose second thunk
  throws re-runs both thunks on retry. Test: `references-fold.test.ts:85`.
- **table-declaration / table() itself never resolves a reference thunk** —
  OK. `table()` (`table.ts:1335-1424`) feeds only `extrasForeignKeys`
  (already resolved) to `assertNoDoublyDeclaredReference`,
  `validateColumnRefs` and `validateDuplicateNames`; the fold lives in the
  `get foreignKeys()` getter. Measured: an unconditionally-throwing thunk
  does not run during `table()` (0 calls) and the declaration constructs.
  Note (spec-silent, correct): a thunk *of another table* can still run
  during a `table()` call if an `extras` callback reads that other
  table's `foreignKeys` — the requirement sentence is unscoped but its
  scenario scopes it to "that table", which is what shipped. Test:
  `references-fold.test.ts:119`.
- **cross-check: `@hejbro/query` relation derivation** — OK, not broken by
  the lazy getter. `packages/query/src/db/related.ts:63` (`forwardEdge`)
  and `:108` (`buildReverse`) read `meta.foreignKeys` inside
  relation-building functions called at query-build time, long after every
  declaration module has evaluated — never at module scope.
- **cross-check: skills/hejbro** — OK, not drift.
  `references/dsl-cheatsheet.md:92,101` documents the deferred thunk and
  that cross-file `.references()` "resolve regardless of which one loads";
  `references/function-builder-pitfalls.md:68` documents the
  `.returning({...})`-final projected form;
  `references/polyrepo.md:62` documents the `synced-function-declared`
  refusal. No skill file quotes `verify`'s message text.
- **cross-check: AGENTS.md** — OK on accuracy (see R2-NB1 on scope).

### Method

Context-free. Read only: `openspec show harden-verify-and-dsl --diff`
(which prints the proposal prose ahead of the deltas — that prose was not
used as evidence; every claim above was re-derived from source, tests or
measurement), this file's `## Round 1` and `## Round 1 disposition`
sections (as claims to verify), `openspec/specs/cli-commands/spec.md`'s
verifiable-chain requirement, and the named source files. No `tasks.md`,
no `proposal.md` as a source, no PR body, no git log, no `blackbox/`, no
`.agents/`. No repository file was modified except this report.

Static reading: `packages/core/src/dsl/table.ts` (`memoizedForeignKeys`
1250-1266, `foldColumnReferences` 1291-1330, `table()` 1335-1424),
`packages/core/src/engine/generate.ts` (`resolveFunctionDeclaration`),
`packages/core/src/plpgsql/body-context.ts` (`ReturnableQuery`,
`BodyContext.return`), `packages/cli/src/commands/verify.ts`
(`chainTipMismatchMessage`, `runCheck4`, `runCheck4IfEligible`,
`readChainEntries`, `identityFromMessage`), `packages/cli/src/loader.ts`,
`packages/cli/src/commands/init.ts`,
`packages/cli/test/support/cli-runner.ts` (`assertFreshBuild`,
`assertBuiltCli`), `packages/cli/test/loader-cycle.test.ts`,
`packages/core/test/dsl/references-fold.test.ts`,
`packages/core/test/plpgsql/render-body.test.ts`,
`packages/core/test/engine/function-authority-refusal.test.ts`,
`packages/query/src/db/related.ts`, AGENTS.md, the three skill references.

Measurement: `pnpm --filter @hejbro/core exec vitest run
test/dsl/references-fold.test.ts test/plpgsql/render-body.test.ts
test/engine/function-authority-refusal.test.ts
test/dsl/cte-column-ref.test.ts` — 4 files, 24 tests, green.
`pnpm --filter hejbro exec vitest run test/loader-cycle.test.ts` — fails
in `beforeAll` with the stale-build message (quoted above), 2 skipped;
read only, as instructed. No `pnpm build`, no `pnpm install`, no
workspace-wide `test`/`check-types`.

Adversarial probes ran in a throwaway harness under
`/private/tmp/hejbro-r2` (deleted afterwards; nothing written into the
repository): a vitest root aliasing `@hejbro/core`/`@hejbro/query` to
their sources and driving `loadConfig`/`loadDeclarations`/`runGenerate`/
`runVerify` from `packages/cli/src` in-process, plus a
`node_modules/hejbro` shim re-exporting `packages/core/src/index.ts` so
jiti-loaded fixtures resolve to source. Probes: thunk that throws once
then succeeds; thunk that throws on every read; two reference columns
where the second throws; two successful reads (call count and array
identity); a table read inside another table's `extras` callback during
`table()`; a self-reference; a same-file forward reference in both
declaration and both read orders; the two repo cycle fixtures against
`dist` (reproducing round 1's failure) and against source, in both file
orders, through `loadDeclarations` and then `generateMigration` (SQL
diffed byte-for-byte); `verify` on a corrupted tip banner with default
and with custom `migrationsDir`/`snapshotPath`, with an unbannered file
sorting last, on an empty migrations directory, and with the snapshot
deleted; `ctx.return` with a projected `returning` on insert, update and
delete, with the bare `returning`, and with no `returning`, both rendered
and `tsc --noEmit`-checked under the repository's own `tsconfig.base.json`
compiler options; `generateMigration` over a hand-tagged
`authority: "usage"` function and over a `defineFunction` +
`defineTrigger` schema.
