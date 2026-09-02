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
  same test (`9375f842`).
- **NB3** — closed. Dropped the delta's unobservable "after every
  declaration module has evaluated" clause (`9375f842`, same commit as
  NB2's text narrowing — both are the same paragraph).
- **NB4** — out of scope for this round, tracked as #686. Not touched.
- **NB5** — closed. `foldColumnReferences`'s doc comment no longer
  claims `existing-table.ts`/`rls.ts` reuse it; names the actual sole
  caller, `memoizedForeignKeys` (`3b133a39`).
- **NB6** — out of scope for this round, tracked as #687. Not touched.
