# Work — quickstart-now/hejbro#1050

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 1.1: SetOpStage branch-stage carrier — gates and barrel measurement

_2026-09-08T18:10Z_

Task 1.1 (`SetOpStage` carries both branch stage types) implementation
measured before commit, on top of d5ac10f0 (`widen-set-op-execute`
worktree), uncommitted diff: `packages/core/src/query/select.ts` +
new `packages/core/test/query/set-op-stage.types.test.ts`.

**Barrel re-export.** `grep -n "SetOpCombinators" packages/core/src/index.ts`
— zero matches. `SetOpCombinators` (converted `type` → `interface` to
carry polymorphic `this`) is not part of the public barrel; the
`type`→`interface` conversion has no declaration-merging surface exposed
to consumers.

**Runtime `this` reads.** `grep -n "\bthis\b" packages/core/src/query/select.ts`
outside doc comments: six matches, all inside `SetOpCombinators`'s own
method return-type annotations (`SetOpStage<TProjection, this, TOther>`).
The three runtime factories (`combineSetOp`, `setOpCombinators`,
`makeSetOpStage`) read only their own closure variables
(`left`, `node`, `projectionInput`, `other`, `count`, `terms`) — zero
runtime reads of `this`.

**Serial gates (brief order, each run to completion before the next):**
- `TURBO_FORCE=1 pnpm check` — exit 0 (biome: 779 files, 0 errors; 3
  pre-existing warnings in `scripts/check-modified-titles.mjs`
  (`noAccumulatingSpread`), unrelated to this change)
- `TURBO_FORCE=1 pnpm check-types` — exit 0 (turbo: 19/19 tasks —
  `@hejbro/core`, `@hejbro/query`, `hejbro` (cli), `@hejbro/supabase`,
  `@hejbro/pg`, `@hejbro/neon`, `@hejbro/nile`, `preset-smoke`,
  `example-postgres`, `example-supabase`, `cli-smoke`)
- `TURBO_FORCE=1 pnpm test` — exit 0 (turbo `test`: 19/19; turbo
  `test:types`: 2/2 — `hejbro` 102 files / 1635 tests, all green)
- `pnpm check:crap` — exit 0 (1730 functions scanned across
  `@hejbro/core`, `@hejbro/neon`, `@hejbro/nile`, `@hejbro/pg`,
  `@hejbro/query`, `@hejbro/supabase`; 0 over CRAP 5, 53 at exactly 5;
  README badge byte-identical)
- `pnpm check:modified-titles` — exit 0 ("2 active change(s), every
  delta title matches its base spec")

Re-run identically after trimming the `SetOpCombinators` doc comment to
the lead-approved constraint sentence (738/R2 condition 1) — same five
results.

**Process deviation.** Task 1.1 is a `[design]` task; the implementation
(the `SetOpStage` parameter shape and the `type`→`interface` conversion
for `SetOpCombinators`) was written and red/green-verified in the
working tree before the planner's measurement-spike-first instruction
arrived — the two crossed in flight. The result matched the
lead-approved signature (738/R2) once reviewed; no rework was needed.

<a id="w2"></a>
## W2 — 1.1: git stash usage during red verification (predates 412/R35)

_2026-09-08T18:10Z_

Red-verification for task 1.1 used `git stash push --keep-index --
packages/core/src/query/select.ts` (revert just that file, confirm the
new type test fails with TS2707, `git stash pop` to restore) — this
predates the lead ruling that `git stash` is off-limits in a worktree
(412/R35, shared stash stack across worktrees). Checked immediately
after: `git stash list` showed only two pre-existing entries, both
`WIP on (no branch): 58ab249`, neither created by this session and
neither touched. The stash used for this task's own red verification
was already popped (restored) before this check, so nothing of mine
remained on the shared stack. No entries were dropped.

<a id="w3"></a>
## W3 — 1.2: ExecuteResult folds both branches, flat shapes -- gates, red evidence, #944 measurement

_2026-09-08T18:33Z_

Task 1.2 (`ExecuteResult` folds both branches, flat shapes) implementation
measured before commit, on top of 1e6b78c4 (`widen-set-op-execute`
worktree), uncommitted diff: `packages/query/src/db/db.ts` +
`packages/query/test/db/execute-result-type.test.ts` (new describe
block, 7 rows, added to the file's own existing core-built-set-op
describe block area).

**Red, per row, against the pre-1.2 `db.ts`** (verified via
`git diff > patch && git checkout -- db.ts` — never `git stash`,
per 412/R35 — then `git apply patch` to restore):
- Row 2 (numeric-mode type union): `error TS2344` — old fallback gives
  `{ num: number | null }` (left-only, blanket-nulled); new expects
  `{ num: number | bigint }` (no null, both branches notNull).
- Row 3b (#944 repro — notNull LEFT × nullable RIGHT, whole-table
  fixtures chosen specifically so the old fallback can't coincidentally
  match, unlike an object projection's blanket null-widening): old
  fallback resolves `{ id: string; flag: string }` (left-only,
  ignores the right branch's own nullable declaration entirely); new
  expects `{ id: string; flag: string | null }`. Printed via a
  temporary probe (`const _p: "PRINT_ME" = null as unknown as Row`,
  deleted before commit) to confirm the exact old-resolved shape before
  trusting the mismatch.
- Row 5 (neither branch joins, notNull object projection): `error
  TS2344` — old fallback always widens an object-projection field to
  `| null` for the untracked-joins default; new expects `{ body: string
  }` (not widened) — this is the core-built carve-out's own defect,
  closed here.
- Rows 1, 3a, 4a, 4b, 7 did not themselves diverge from the old
  fallback's answer (row 1: whole-table `SelectResult` never reads
  `TLeftJoined` at all, so tracked-vs-untracked is moot; rows 3a/4a/4b:
  the old fallback's blanket object-projection null-widening
  coincidentally produces the same nullable answer the new fold also
  produces, for an unrelated reason; row 7 has no "old" comparison, it
  pins parity with the already-correct chain surface) — asserted anyway
  per the task's own input table (breadth of the table, not "does every
  cell differ from the old code", is the D110 requirement), and every
  row's own literal shape is pinned regardless.

**Serial gates (brief order), on top of the diff described above:**
- `TURBO_FORCE=1 pnpm check` — exit 0 (biome: 0 errors; 3 pre-existing
  warnings in `scripts/check-modified-titles.mjs`, unrelated; one
  formatting fix applied via `biome format --write` to `db.ts` and the
  test file before this run, from a first pass that had exit 1)
- `TURBO_FORCE=1 pnpm check-types` — exit 0 (turbo: 19/19 tasks)
- `TURBO_FORCE=1 pnpm test` — exit 0 (turbo `test`: 19/19 — `@hejbro/query`
  68 files / 1150 tests, `@hejbro/core` 108 files / 2312 tests + 1 todo,
  `hejbro` 102 files / 1635 tests, all green; turbo `test:types`: 2/2)
- `pnpm check:crap` — exit 0 (0 violations, 53 at exactly CRAP 5, README
  byte-identical)
- `pnpm check:modified-titles` — exit 0 ("2 active change(s)")

**#944 measurement (facts only, no verdict):**
(a) A nullable RIGHT branch now reads as nullable through the core-built
    + `db.execute` path, for any statement actually built with the real
    combinators (`.union()` et al. — both branch parameters filled, per
    task 1.1): confirmed directly by row 3b's own red-then-green
    (old: `flag: string`; new: `flag: string | null`).
(b) Surfaces still reading a nullable-right-branch column as non-null:
    - A hand-annotated, one-argument `SetOpStage<TProjection>` (both
      branch parameters left at their `unknown` default) — deliberately
      unchanged (design.md Q2, "today's exact fallback"): resolves
      `SelectResult<TProjection>` from the LEFT branch's own declaration
      alone, blind to the right branch's nullability, same as before
      this whole change.
    - A nested branch (one side of the combinator is itself a
      `SetOpStage`, e.g. `(a union b) except c`) is not yet folded at
      all here — `SetOpBranchRow` only matches `SelectLimited`, so a
      nested branch resolves to `never`, making the WHOLE result
      `SetOpResult<never, X> = never` (task 1.3's own arm, deliberately
      absent so 1.3's own red stays red — a different failure mode from
      #944's "silently reads non-null", not measured further here).
    - A recursive CTE's own nullability does not go through
      `ExecuteResult`'s `SetOpStage` arm at all — it uses a separate
      mechanism (`with.ts`'s `WidenedBy`/`RecursiveCteReference`, read
      by `SelectResult`'s own `NestedOrExprResult`), untouched by this
      task's diff. Whether recursive CTEs have their own analogous gap
      was not measured — out of task 1.2's scope.
    - The chain surface was not non-null-blind before this change and
      is unaffected by it (`chainSetOpCombinators` already folds both
      branches' own resolved rows through `SetOpResult`, predating
      widen-set-op-execute).

<a id="w4"></a>
## W4 — 1.3: nested branches and every combinator -- gates, red evidence, closes W3's never-regression

_2026-09-08T18:51Z_

Task 1.3 (`ExecuteResult` folds nested branches, every combinator)
implementation measured before commit, on top of 7069c40f
(`widen-set-op-execute` worktree), uncommitted diff:
`packages/query/src/db/db.ts` + `packages/query/test/db/execute-result-type.test.ts`
(new describe block, 11 cases: 6 flat combinator guards + 5 nested/
crossed cases).

**Red, already present before this task's own diff** (the W3 measurement
already reported it: a nested branch collapsed to `never` under 1.2's
flat-only `SetOpBranchRow`, worse than the pre-1.1 fallback). Confirmed
directly by adding the 5 nested-shape assertions and running
`check-types` before touching `db.ts` further:
```
error TS2344: Type '{ readonly body: string | null; }' does not satisfy the constraint '"Expected: ..., Actual: never"'.
  (left-nested pair 1, left-nested pair 2, three levels)
error TS2344: Type '{ readonly id: string; readonly flag: string | null; }' does not satisfy the constraint '"Expected: ..., Actual: never"'.
  (right-nested pair 1, right-nested pair 2)
```
The 6 flat combinator-guard cases did not go red (flat shapes already
resolve correctly since task 1.2 — they exist to catch a FUTURE
regression that special-cases one combinator by name, per the task's
own mutation-testing framing, not to prove anything new here).

**Implementation**: `SetOpBranchRow` gained a second arm —
`TStage extends SetOpStage<infer P, infer L, infer R> ? SetOpExecuteRow<P, L, R> : never`
— mutually recursive with `SetOpExecuteRow` (which already called
`SetOpBranchRow` on both sides since task 1.2). No combinator-specific
branching anywhere; the fold is purely structural over `SetOpStage<P,
L, R>`'s own shape, which is why all six combinators and every nesting
depth resolve through the one recursive pair.

**Green**: `check-types` exit 0 after the arm was added; `vitest run`
for `@hejbro/query`: 68 files / 1161 tests (was 1150 before this task's
+11 new cases), all passing.

**Serial gates (brief order), on top of the diff described above:**
- `TURBO_FORCE=1 pnpm check` — exit 0 (biome: 0 errors; 3 pre-existing
  warnings in `scripts/check-modified-titles.mjs`, unrelated)
- `TURBO_FORCE=1 pnpm check-types` — exit 0 (turbo: 19/19 tasks). A
  background diagnostic tool briefly reported "Cannot find module
  '@hejbro/core'" and several unrelated `any`/`never[]` errors on
  `db.ts`/the test file during the `pnpm test` run (turbo's own
  `test:types` phase rebuilds `dist`, and the watcher polled mid-
  rebuild) — a targeted re-run immediately after
  (`pnpm --filter @hejbro/query --filter @hejbro/core check-types`)
  came back clean, exit 0, confirming the transient read.
- `TURBO_FORCE=1 pnpm test` — exit 0 (turbo `test`: 19/19 — `@hejbro/query`
  68/1161, `@hejbro/core` 108/2312+1 todo, `hejbro` 102/1635, all
  green; turbo `test:types`: 2/2)
- `pnpm check:crap` — exit 0 (0 violations, 53 at exactly CRAP 5,
  README byte-identical)
- `pnpm check:modified-titles` — exit 0 ("2 active change(s)")

**Status**: the W3-flagged intermediate regression (a nested branch
resolving to `never`, worse than the pre-1.1 left-only fallback) is
closed as of this diff — every nested-shape assertion in the new
describe block resolves the expected row, not `never`.

<a id="w5"></a>
## W5 — 1.4: reference + changeset -- verbatim edits, #944 surface measurement, gates

_2026-09-08T19:04Z_

Task 1.4 (reference + changeset, the group's last task) measured before
commit, on top of 8f24a6b2 (`widen-set-op-execute` worktree),
uncommitted diff: `skills/hejbro/references/query-layer.md` (three
verbatim edits, lead-approved text, not one letter changed) +
`.changeset/widen-set-op-execute.md` (new, `minor`).

**Text edits applied verbatim, as directed** (measured against the
current file before editing, to confirm the exact old text existed
before replacing it):
(a) lines 337-344 (the core-built set-operation carve-out paragraph) --
    full replacement with the lead-approved paragraph.
(b) the recursive-CTE exception clause's own rationale half only
    ("reads nullable regardless -- ...") -- replaced with the lead-
    approved rationale text; the sentence's own behavior half (what
    happens) is unchanged, matching the instruction "the behavior
    sentence unchanged".
(c) one clause added after "a plain set operation keeps the left
    branch's own projection unchanged, nullability included (#944)"
    stating the projection/resolved-row distinction, `(#944)` citation
    left in place as directed (its fate follows the measurement below,
    decided by the lead, not this task).

**Changeset**: `.changeset/widen-set-op-execute.md`, `"@hejbro/core":
minor` (the fixed group means naming one package versions all seven --
`pnpm changeset status` confirms all 7 published packages bump minor).
Written directly rather than through the interactive `pnpm changeset`
prompt (non-interactive shell), matching the existing sibling
changesets' own format exactly (`harden-set-op-families.md` used as the
template). `pnpm check:fixed-group` -- ok, 7 published packages, fixed
group matches exactly.

**#944 surface measurement (facts only, no verdict), lead's own three
questions** -- via a throwaway type probe
(`packages/query/test/types/zz-spike-944.ts`, deleted immediately after
each reading, `git status --short` confirmed clean afterward):

1. Recursive term itself a set operation -- does the outward reference
   read nullable (conservative, per the reference's own claim) or
   non-null? **Not a new probe**: two EXISTING, already-passing tests in
   `packages/query/test/types/select-result.test.ts` already measure
   this directly and are untouched by widen-set-op-execute's own diff
   (a separate mechanism, `with.ts`'s `WidenedBy`) -- "R32 a set-op
   recursive term with both branches non-null still reads nullable
   outward (#500/R6 exception)" (line 614) and "F1 a left join inside a
   set-op recursive term reads nullable outward even though the joined
   column is notNull (#500/R6 exception, #944)" (line 644): both assert
   `| null`, confirming the conservative (always-nullable) reading the
   reference text claims.
2. `withCte((w) => { const x = w.as("x", select(a).union(select(b))));
   return select({ flag: x.flag }, x); })`, `a` notNull, `b` nullable --
   what does reading `x.flag` (a NON-recursive CTE entry) later resolve
   to? Measured: `string` (not `string | null`) -- `w.as`'s own
   `buildCteRowEnvironment` reads `query.projectionInput` directly (the
   raw LEFT-branch projection a `SetOpStage` carries, unresolved, never
   folded through `SetOpResult`), so the right branch's own nullable
   declaration is invisible here. Widen-set-op-execute's own diff never
   touches `with.ts`'s `w.as`/`buildCteRowEnvironment` -- this reading
   is unaffected by tasks 1.1-1.3.
3. Does a VALUE-LEVEL (real builder) statement ever land on the bare,
   one-argument `SetOpStage<TProjection>` fallback (both branch
   parameters at their literal `unknown` default)? Measured via the
   correct extraction technique (`infer` against the alias directly,
   the same `LeftStageOf`/`RightStageOf` pattern task 1.1's own type
   test uses) on `select(flagNotNull).union(select(flagNullable))`'s
   own real type: both extracted branch parameters are concrete,
   filled types (`SelectDistinctable<typeof flagNotNull, never>` and
   the structurally equivalent shape for the right branch), never
   `unknown`. A first attempt at this measurement used a whole-stage
   mutual-`extends` comparison instead and reported a false "equal to
   the bare form" -- a known pitfall for this specific self-referential
   alias, already documented by `select-join-types.test.ts`'s own
   `LeftJoinedOf` comment (comparing two fully-applied recursive stage
   types can't tell a filled carrier from a dropped one); re-measured
   with the correct technique before trusting the result.

**Serial gates (brief order), on top of the diff described above:**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (3 pre-existing warnings,
  unrelated)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0 (turbo: 19/19 tasks)
- `TURBO_FORCE=1 pnpm test` -- exit 0 (turbo `test`: 19/19; turbo
  `test:types`: 2/2)
- `pnpm check:crap` -- exit 0 (0 violations, 53 at exactly CRAP 5)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s)")
- `pnpm check:fixed-group` -- exit 0 (own initiative, changeset-
  adjacent; `check:pr-changeset` needs a real PR number to diff
  against and was not run -- CI's own job, not reachable pre-PR)

**Task-time note**: no stopwatch was kept per task -- the durations
below are retrospective impressions from this session's own message
timeline, not measured, reported as estimates per the lead's own
instruction to mark them as such if uncertain.

<a id="w6"></a>
## W6 — group 1: set-op branches carried and folded

_2026-09-08T19:09Z_

Group 1 (widen-set-op-execute, #738 tracking issue #1050) closed out.
Measurements only, summarizing the four tasks already recorded in
W1-W5.

**Tasks**: 1.1 (`SetOpStage` carries both branch stage types, core),
1.2 (`ExecuteResult` folds both branches, flat shapes, query), 1.3
(recurses through nested branches, every combinator, query), 1.4
(reference + changeset, skills + changeset).

**Commits**: 8, in three feat/docs+chore-blackbox pairs plus the
group-open commit:
- d2267133 chore(openspec): nest either side, split tasks 1.2/1.3/1.4
- 23908d70 feat(core): set-op stages carry both branch stage types
- 1e6b78c4 chore(blackbox): record 1.1 gates, barrel and stash measurements
- a8179a79 feat(query): execute folds a set operation's two branches
- 7069c40f chore(blackbox): record 1.2 gates and #944 measurement
- 7690aec1 feat(query): execute recurses through a nested set-op branch
- 8f24a6b2 chore(blackbox): record 1.3 nesting evidence and gates
- 1d7697b2 docs(skills): set operations read as the union on both surfaces
- e459c400 chore(blackbox): record 1.4 changeset and #944 surfaces

**Gates**: all five (`check`, `check-types`, `test`, `check:crap`,
`check:modified-titles`) ran serially before each of the four tasks'
own implementation commits and returned exit 0 every time (individual
runs already itemized in W1-W5).

**M5 (assignment regression, task 1.1's own scope-widening question)**:
turbo `check-types` across the whole monorepo (19/19 tasks —
`@hejbro/core`, `@hejbro/query` including `chain.ts:913`'s branch-node
accessor, `hejbro` (cli), `@hejbro/supabase`, `@hejbro/pg`,
`@hejbro/neon`, `@hejbro/nile`, and all four example packages) came
back clean both before and after `SetOpStage` gained its two new
parameters — no one-argument/bare consumer position broke. The new
parameters appear only in covariant (return-type) positions throughout;
none was found in a contravariant (parameter) position.

**#944 remaining surface (facts, no verdict — the citation in
`query-layer.md` was left in place per this measurement)**: a
value-level path exists where a nullable right branch still reads
non-null — `withCte((w) => { const x = w.as("x",
select(a).union(select(b))); ... })` where `a` is notNull and `b` is
nullable at the same key: reading `x`'s own field later resolves
non-null, because `w.as`'s `buildCteRowEnvironment` reads
`query.projectionInput` (the raw left-branch projection a `SetOpStage`
carries) directly, never through `SetOpResult`'s fold. Task group 1's
own diff never touches `with.ts`'s `w.as`, so this reading is
unaffected by any of 1.1-1.4. Two other surfaces measured separately
(W5, task 1.4): a recursive CTE whose recursive term is itself a set
operation already reads conservatively nullable (existing tests
R32/F1, unaffected by this diff); a real value-level combinator call
never lands on the bare one-argument `SetOpStage<P>` fallback (only a
hand-written type annotation does).

**Task-time derivation**: no stopwatch was kept during the session;
`openspec/task-times.csv`'s `actual_min`/`waited_user_min` for 1.1-1.4
were derived from the eight commits' own timestamps (grouped into four
spans by each task's last commit) plus a retrospective hands-on/waited
split, both explicitly marked in the CSV's own `notes` column as
derived from commit timestamps, not a stopwatch measurement.

<a id="w7"></a>
## W7 — 1.5a: w.as folds a set operation's two branches, flat shapes -- path B, invariants pinned, gates

_2026-09-08T20:03Z_

Task 1.5a (`w.as` folds a core-built set operation's two branches, flat
shapes) implementation measured before commit, on top of e459c400
(`widen-set-op-execute` worktree), diff: `packages/core/src/query/with.ts`
(new types: `MergedCteRowEnvironment`, `CteSetOpBranchProjection`,
`IsUnfilledCteBranch`, `CteSetOpEnvironment`, `CteSetOpReference`,
`CteAsResult`; `CteBuilder.as`'s own signature widened to dispatch on
the actual query value's type) + new
`packages/core/test/query/cte-set-op-fold.types.test.ts` (17 cases).

**Design decision (path B, lead-ratified via the planner's P1-P4
spikes, all measured before this implementation)**: build each
branch's own `CteRowEnvironment` SEPARATELY (single-source, the
existing whole-table `infer TColumns` branch unmodified and never
re-entered against a synthetic shape), then merge key by key into
`CteFieldRef<L | R>` (one `CteFieldRef` per key, union of both
branches' raw values) -- not by feeding a pre-folded `SetOpResult<
TableA, TableB>` through `CteRowEnvironment` again (measured broken:
collapses to `CteFieldRef<unknown>`, since `infer TColumns` cannot
reverse-solve a homomorphic mapped type from a union-valued synthetic
object). The merge key range comes from the two environments'
`keyof` (not the raw projections' `keyof`), avoiding `Table`'s own
hidden `tableMeta` brand key, which would otherwise violate
`CteFieldRef`'s `extends Expr` constraint (also measured).

**Runtime diff: zero.** `buildCteRowEnvironment` already reads
`query.projectionInput` -- the left branch's own raw projection --
which matches "left branch's keys" (SQL's own naming rule) exactly;
only the DECLARED return type is richer now. The `w.as` runtime
implementation is unchanged, cast once at the boundary to the new
`CteAsResult<TQuery>` (the same cast-at-boundary pattern `leftJoin`/
`makeChainThen`/`Db["execute"]` already use elsewhere in this
codebase). This sets the review's own scope: the runtime object
`buildCteRowEnvironment` produces was never touched, only its
consumers' declared type.

**Two measured detours, both found and fixed before commit:**
- `expectTypeOf(...).toEqualTypeOf(...)` reported a false mismatch
  comparing two UNIONS of intersected, origin-branded object types
  (both the actual and expected side of the "invariant c" assertions)
  -- confirmed false via a direct bidirectional-`extends` check, then
  the test was redesigned around the actually-reliable comparison
  shape (compare a single, non-union `CteFieldRef<...>` via
  `expectTypeOf(value)`, never a bare union via `toEqualTypeOf<...>`
  on both sides) rather than trusted or worked around blindly.
- A first attempt at the "invariant c" (single-folding-implementation)
  proof tried `T extends CteFieldRef<infer TValue> ? TValue : never`
  to unwrap the reference's own field back to its raw value for
  comparison -- measured broken (silently collapsed to `CteFieldRef`'s
  own default, `Expr`, no error to signal it): `infer` against
  `CteFieldRef`'s own key-REMAPPED mapped type cannot reliably
  reverse-solve from an already-computed concrete shape, the same
  class of failure as the whole-table `Table<infer TColumns>` bug
  (task 1.5's own P1 spike) applied one level up. Redesigned to wrap
  the EXPECTED value in `CteFieldRef<...>` once (forward direction
  only) and compare against the real expression's own inferred type,
  never reverse-inferring through `CteFieldRef` again.
- A `declare const` value was briefly referenced inside an actually-
  executing `withCte((w) => { ... w.as("x", handWritten) ... })`
  callback for the "hand-annotated SetOpStage<P> fallback" test --
  `declare const` is erased entirely at compile time, so this failed
  at RUNTIME (`vitest run`, not `check-types`, which stayed green
  throughout) once the test suite actually executed the callback.
  Redesigned to a pure type-only instantiation
  (`ReturnType<typeof cteBuilderAs<SetOpStage<P>>>`, the same
  `Db["execute"]`-style technique this package's own type tests
  already use elsewhere) that never constructs or calls a real value.

**Invariants pinned by test, not argument (lead's own explicit
instruction after P1(c) was flagged as unproven):**
(a) A non-set-op `w.as()` entry's own row environment is unchanged --
    two dedicated tests (whole-table and object-projection `select()`
    entries) assert the exact pre-1.5a `CteFieldRef<...>` shape.
(b) The recursive term path is untouched -- `with-recursive.ts`/
    `asRecursive` were never edited; `git diff --stat` against
    `packages/core/test/query/with.test.ts` and
    `.../with-recursive.test.ts` shows zero changes, and both suites
    (unmodified) pass unchanged alongside the new file.
(c) One folding implementation only -- two tests assert the
    reference's field type equals `CteFieldRef<SetOpResult<...>
    ["key"]>` exactly (the same formula `@hejbro/query`'s own
    `SetOpBranchRow`/`SetOpExecuteRow`, db.ts tasks 1.2/1.3, and
    `select.ts`'s own combinator compatibility gate all reuse, never a
    re-derived one), and the object-projection case additionally
    asserts the key set matches `SetOpResult`'s own key set exactly,
    both directions.

**Red, verified via `git diff > patch && git checkout -- with.ts` then
`git apply patch`** (never `git stash`, 412/R35): 14 `tsc` errors
against the pre-1.5a `with.ts`, all in the new test file, all showing
the old (left-only) `CteFieldRef<A>` shape instead of the expected
folded `CteFieldRef<A | B>`. Restored, re-verified green (exit 0).

**Serial gates (brief order):**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (one formatting fix applied via
  `biome format --write` before this run; 3 pre-existing warnings,
  unrelated)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0 (turbo: 19/19 tasks)
- `TURBO_FORCE=1 pnpm test` -- exit 0 (turbo `test`: 19/19 --
  `@hejbro/core` 109 files / 2329 tests + 1 todo, up from 108/2312;
  turbo `test:types`: 2/2)
- `pnpm check:crap` -- exit 0 (0 violations, 53 at exactly CRAP 5)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s)")

<a id="w8"></a>
## W8 — 1.5a: final cell design (spec-derived axes) and mutation self-check -- vacuous cells found and fixed

_2026-09-08T20:22Z_

Task 1.5a (`w.as` folds a core-built set operation's two branches, flat
shapes) -- final cell design and mutation self-check, superseding the
earlier W7 entry's own cell table (kept for the implementation/
invariant record; this entry covers the cell-design correction and the
mutation-driven verification that followed it).

**Cell design, final** (lead-ratified, derived from the query-type-
inference spec's own untracked-widening rule, lines 101-125/130-141):
- Whole-table branches: the `from` table's own declared nullability is
  kept (the statement's `from` position is tracked), so the
  nullability axis (`#944`'s own shape: LEFT notNull x RIGHT nullable,
  and the reverse) is the one this observation point (`CteFieldRef<T>`'s
  own `T`, `@hejbro/query`'s OP7) can detect.
- Object-projection branches: the declared-READ-TYPE axis (not
  nullability) is what this observation point cleanly detects --
  `integer` vs `bigint({mode:"bigint"})`, both notNull, same family
  ("numeric"), different resolved TS mode.
- Do not assume either axis is empty without measuring: the rule
  above is a starting hypothesis from the spec text, not a substitute
  for the mutation self-check below, which is what actually settles
  emptiness per cell.

**Mutation self-check** (`packages/core/src/query/with.ts`, one-line
mutation: `CteSetOpEnvironment`'s own conditional forced to
`true extends true ? CteRowEnvironment<TProjection> : ...` -- folding
disabled, always the left-only fallback; restored via
`git diff > patch && git checkout -- with.ts` then `git apply patch`,
never `git stash`, 412/R35):

First pass (17 cells, before the fix below) -- 12 of 17 assertions
went red, 5 stayed green. Of the 5: 3 were EXPECTED to stay green
(the hand-written-fallback test, and both invariant-(a) non-set-op
tests -- none of these exercise the mutated code path at all). The
other 2 were a genuine finding: "both branches notNull, DIFFERENT
tables, otherwise identically-shaped columns" (one whole-table cell,
one object-projection cell) did NOT detect the mutation --
`toEqualTypeOf` reported the folded union (`CteFieldRef<A | B>`) equal
to the unfolded left-only fallback (`CteFieldRef<A>`) under the
mutation, because two tables with STRUCTURALLY IDENTICAL column
declarations produce STRUCTURALLY IDENTICAL column-ref types in
TypeScript's own structural system -- table identity (which `table(...)`
call produced the object) carries no type-level distinction, so `A | B`
collapsed to `A` before the mutation even mattered. A vacuous cell,
exactly the failure pattern the reviewer's own mutation pass separately
found in a different file (task 1.3's own flat cells, #738) -- this is
the SAME class of trap recurring in a THIRD independent place, this
change's own "positive control" cells.

Fix: replaced both vacuous cells with a genuinely divergent pair
(`integer` vs `bigint({mode:"bigint"})`, both notNull, same family,
different resolved TS mode -- the axis the approved 1.6 contract text
names directly, "the union of both branches' declared read types").

Second pass (17 cells, after the fix) -- 14 of 17 assertions went red
(the same 3 expected-unaffected tests stayed green, confirmed by exact
line-number mapping against the file's own `it()` block boundaries).
Every cell intended to be non-empty was confirmed non-empty by direct
measurement, not by argument.

**Serial gates (brief order), on the restored (non-mutated) diff:**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (one formatting fix applied
  earlier; 3 pre-existing warnings, unrelated)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0 (turbo: 19/19 tasks;
  a background diagnostic tool repeatedly surfaced stale errors from
  already-deleted spike files and a dist-rebuild timing window during
  this session -- re-verified clean via a direct, explicit `tsc
  --noEmit` invocation each time before trusting the result)
- `TURBO_FORCE=1 pnpm test` -- exit 0 (turbo `test`: 19/19 --
  `@hejbro/core` 109 files / 2329 tests + 1 todo; turbo `test:types`: 2/2)
- `pnpm check:crap` -- exit 0 (0 violations, 53 at exactly CRAP 5)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s)")

No runtime cells exist in this task (packages/core is a pure package,
no driver/execution layer) -- the "JS-shape-diverging runtime
declaration" rule (int vs bigint at the value level) does not apply
here; noted per the lead's own instruction to report this fact rather
than silently skip the rule.

<a id="w9"></a>
## W9 — 1.5b: nested cte fold, invariant-c strengthened (shared SetOpResult), bidirectional mutation asymmetry

_2026-09-08T20:40Z_

Task 1.5b (CTE fold recurses, invariant-c strengthened, recursive entry
untouched) implementation measured before commit, on top of `5bd430aa`
(`widen-set-op-execute` worktree), diff: `packages/core/src/query/with.ts`
(refactor + nested arm) + `packages/core/test/query/cte-set-op-fold.types.test.ts`
(+7 cases: 6 nested, 1 recursive-invariant).

**Invariant (c) strengthened: shared type-level function, not a second
implementation.**
- `MergedCteRowEnvironment` no longer writes `TLeft[K] | TRight[K]` by
  hand -- it now indexes `SetOpResult<TLeftProjection, TRightProjection>`
  directly (the fold is CONSUMED, not re-derived). Value equality with
  `SetOpResult`'s own output was already proven in W7/task 1.5a; this
  closes the gap the lead flagged (value equality alone would still
  pass for two independently-correct implementations that could later
  diverge).
- `CteSetOpBranchProjection`/`IsUnfilledCteBranch` (core, `with.ts`)
  CANNOT be the literal same symbol as db.ts's `SetOpBranchRow`/
  `IsUnfilledBranch` (`@hejbro/query`) -- core purity forbids
  `packages/core` importing `packages/query` (dependency runs query
  core, never the reverse). Reported this constraint to the planner
  before proceeding; no objection raised. The one symbol that CAN be
  (and now is) physically shared is `SetOpResult` itself, defined once
  in `packages/core/src/query/select.ts`, imported unchanged by both
  `db.ts` and `with.ts`. The per-package "is this branch filled"
  dispatch wrappers are necessarily parallel (different input/output
  tiers -- query-layer resolved rows vs. core-layer projections), not
  a re-derivation of the fold rule itself.
- Nested branches route through {@link SetOpResult} recursively too
  (`CteSetOpBranchProjection`'s own nested arm) -- the nested fold's
  OUTPUT is a plain, non-nominal record, which routes
  `CteRowEnvironment`'s object-projection branch (never its whole-table
  `infer TColumns` branch, the one task 1.5a's own P1 spike measured
  broken against a synthetic input) at whichever level
  `MergedCteRowEnvironment` eventually reads it -- verified by the red-
  then-green cycle below, not by argument.

**Mutation self-check, two stages per the lead's own order requirement
(non-emptiness before asymmetry -- an asymmetry claim with no non-
emptiness evidence is not accepted):**

Stage 1 -- non-emptiness (nesting axis specifically): reverted
`with.ts` to its 1.5a-committed state (nesting arm absent,
`git diff > patch && git checkout -- with.ts`, restored via
`git apply patch`, never `git stash`) and confirmed via `tsc`: all 6
new nested cells red (exactly, by line number), the pre-existing 17
flat/invariant cells from 1.5a unaffected. Nesting is independently
non-empty, not inferred from the flat case.

Stage 2 -- bidirectional asymmetry, only run after stage 1 passed:
- Mutated `SetOpResult` itself (`select.ts`, the one physically shared
  symbol) to fold left-only, rebuilt `@hejbro/core`'s dist, and checked
  BOTH packages: `@hejbro/core` (this file) -- 20/20 set-op cells (14
  flat + 6 nested) red; `@hejbro/query` -- `execute-result-type.test.ts`
  5 assertions red AND `chain-types.test.ts` 1 assertion red. All three
  surfaces (execute, chain, CTE) broke together from the ONE shared
  mutation -- direct evidence of one shared fold, not three
  independently-maintained copies that happen to agree.
- Reverse direction: mutated ONLY `with.ts`'s own `CteSetOpEnvironment`
  (CTE-specific dispatch, left-only fallback forced, `SetOpResult`
  itself untouched) and confirmed `@hejbro/query check-types` stayed
  clean (exit 0) -- `execute-result-type.test.ts`/`chain-types.test.ts`
  unaffected, confirming the CTE-only wiring carries no leak into the
  shared surfaces. `@hejbro/core`'s own 20 set-op cells went red
  (expected, the mutation is CTE-specific but core has no execute/
  chain cells of its own to distinguish from).
- Both mutations restored via `git diff > patch && git checkout --
  <file>` then `git apply patch`; `git diff --stat` confirmed clean
  before proceeding each time.

**Invariant (b), recursive entry untouched:** `with-recursive.ts`
never edited; `git diff --stat` against `packages/core/test/query/
with.test.ts` and `.../with-recursive.test.ts` shows zero changes,
both suites pass unmodified. One new test pins ABSENCE of a positive
claim, per the lead's own instruction not to freeze a behavior a
follow-up issue may still change: a recursive term that is itself a
set operation still type-checks (the compatibility gate is
unaffected), with NO assertion about what nullability it reads back
as (that boundary is #1053's own, closed won't-fix, out of this
change's scope either way).

**Cell design, unchanged from 1.5a's own axes** (spec-derived,
lead-ratified): whole-table nested cells cross the nullability axis
(`flagTableNotNull`/`flagTableNullable`); object-projection nested
cells cross the declared-read-type axis (`numericLeft`/`numericRight`,
integer vs bigint mode). The flat cells (task 1.5a) serve as this
task's own topic-external control -- they already prove the base fold
works without nesting, so a nested cell's own red is attributable to
nesting specifically.

**Serial gates (brief order):**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (one formatting fix applied via
  `biome format --write` before this run; 3 pre-existing warnings,
  unrelated)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0 (turbo: 19/19 tasks)
- `TURBO_FORCE=1 pnpm test` -- exit 0 (turbo `test`: 19/19 --
  `@hejbro/core` 109 files / 2336 tests + 1 todo (up from 2329);
  `@hejbro/query` 68 files / 1161 tests, unaffected; turbo `test:types`: 2/2)
- `pnpm check:crap` -- exit 0 (0 violations, 53 at exactly CRAP 5)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s)")

**Team-brief constants (lead's own promotion), recorded here as
directed:**
1. Rule 3 strengthened: in a structurally-typed language, "a different
   table" is not a control by itself -- a control must be a
   declaration that actually diverges. This change's own fifth vacuous-
   cell instance (task 1.5a's own two "both notNull, different table,
   identical column shape" cells) was the FIRST case where the control
   itself, not the test subject, was the vacuous one -- found only by
   mutation, not by reading the test.
2. "Diagnostic tool output is not truth, a gate's own exit code is" --
   a background tsserver-style watcher repeatedly surfaced stale
   errors from already-deleted spike files and mid-rebuild timing
   windows throughout this whole change (recorded previously, W2);
   every one of those was resolved by re-running the actual gate
   command explicitly and trusting its exit code instead.

<a id="w10"></a>
## W10 — 1.5b (final): the branch-carrying convention lives once in core -- 4-mutation protocol re-run, decisive drift-closure evidence

_2026-09-08T21:11Z_

Task 1.5b's own convention-promotion refactor (lead's "🛑 정정" ruling:
the branch-extraction/unfilled-sentinel judgment moves to core, not
just the row-vs-projection layer interpretation) implemented and
verified, on top of `5bd430aa` (`widen-set-op-execute` worktree). Diff:
`packages/core/src/query/select.ts` (+`IsUnfilledBranch`,
+`SetOpStageBranches`, both exported), `packages/core/src/index.ts`
(barrel), `packages/core/src/query/with.ts` (consumes the two shared
symbols, drops its own local duplicates), `packages/query/src/db/db.ts`
(same).

**Why beyond W9:** W9's own bidirectional mutation already proved
`SetOpResult` is the one physically shared fold. It could not yet prove
the *dispatch convention itself* (is this branch unfilled, extract a
`SetOpStage`'s own triple) was shared -- at that point `with.ts` and
`db.ts` each still carried an independently-typed copy of
`IsUnfilledBranch`/the `infer`-triple extraction. Two independently
maintained copies of the SAME formula can still silently drift the
moment only one is ever touched again -- exactly the risk invariant (c)
exists to rule out. Promoting both to `packages/core/src/query/
select.ts` (core purity holds: only core -> nothing, query still only
imports FROM core) and having both consumers import them removes that
residual drift risk. Full 4-mutation protocol re-run against this
final state before commit.

**Mutation protocol (lead's own numbering), each restored via
`git diff > patch && git checkout -- <file>` then `git apply patch`
before the next, `git diff --stat` confirmed clean each time -- never
`git stash`:**

- **① `SetOpResult` itself (`select.ts`) folded left-only.** Core: 12
  of 24 `it()` blocks red -- exactly the 6 flat + 6 combinator-guard
  cells (task 1.5a), which hand-write their expected union literally.
  The 2 invariant-c cells and all 6 nested cells stayed green -- NOT a
  gap: both build their own "expected" value by calling `SetOpResult`
  directly (documented in the test file's own header), so under a
  `SetOpResult`-internal mutation the actual pipeline value and the
  test's own expected value move together and stay tautologically
  equal. Confirmed by reading both cell forms side by side (flat cells
  hand-write `A["k"] | B["k"]`; nested/invariant-c cells compute
  `SetOpResult<...>["k"]`). These cells test consumption fidelity, not
  formula correctness -- the flat cells are what already prove the
  formula itself. Query: `execute-result-type.test.ts` 5 assertions
  red, `chain-types.test.ts` 1 assertion red (chain's own compatibility
  gate imports `SetOpResult` directly).
- **② `db.ts`'s own layer interpretation** (`SetOpExecuteRow`'s fold
  forced left-only, `SetOpResult`/`with.ts` untouched): `execute-
  result-type.test.ts` 5 assertions red, `chain-types.test.ts`
  unaffected (0). `@hejbro/core check-types` stayed clean (exit 0) --
  expected on structural grounds alone (core cannot see `@hejbro/
  query`'s own source), confirmed anyway.
- **③ `with.ts`'s own layer interpretation** (`MergedCteRowEnvironment`
  forced left-only, `SetOpResult`/`db.ts` untouched): core 16 of 24
  cells red -- the same 12 flat/combinator + both invariant-c cells
  (this mutation is NOT the tautological `SetOpResult`-internal kind:
  the actual pipeline value now diverges from the test's own
  `SetOpResult`-computed expected value) + 2 of 6 nested cells
  (`right-nested` whole-table and object-projection). The remaining 4
  nested cells (`left-nested` x2, `three-level` x2) stayed green under
  THIS SPECIFIC mutation -- traced to a fixture-asymmetry artifact, not
  a real gap: `CteSetOpBranchProjection`'s own recursive arm still
  calls `SetOpResult` directly and correctly (untouched by this
  mutation, since it only touched the outermost `MergedCteRowEnvironment`
  merge step) -- so the inner nested projection is still computed
  correctly; the outermost merge corruption (left-only) only surfaces
  as a visible mismatch when the RIGHT side of the OUTERMOST fold
  carries strictly more information than the left. In those 4 cells
  the wider/nested side happens to sit on the LEFT of the outermost
  combinator (by the cell's own chosen shape, e.g. `(a union b) except
  c` puts the union on the left), so an outermost-left-only bug is
  invisible there by construction, not by design -- flagged to the
  planner as a fixture-coverage note for a possible future strengthening
  (not blocking this task; the SAME bug is caught by 2 of the 6 nested
  cells plus all 12 flat/combinator cells, so it is not silently
  unguarded overall). `@hejbro/query check-types` stayed clean (exit 0)
  under this mutation -- confirmed isolation: a with.ts-only bug never
  leaks into `@hejbro/query`.
- **④ the shared convention symbol itself** (`select.ts`,
  `SetOpStageBranches` -- mutated so a real `SetOpStage`'s own `right`
  branch is silently replaced by its `left`, `SetOpResult`/db.ts's/
  with.ts's own dispatch code untouched): core 20 of 24 cells red --
  ALL 12 flat/combinator + BOTH invariant-c + ALL 6 nested cells (the
  4 that stayed green under ③ now correctly react here, since this
  mutation corrupts the branch triple BEFORE either package's own
  fold runs, not just the outermost step). The 4 cells that stayed
  green here are exactly the ones that never fold two branches at all
  (the unfilled-branch fallback cell, the two "select() entry
  unchanged" cells, and the recursive-CTE cell) -- correct exemptions.
  Query: `execute-result-type.test.ts` 5 assertions red,
  `chain-types.test.ts` unaffected (0, chain never consumed this
  dispatch convention -- its own branch typing is fully carried by
  task 1.1's `interface`+`this` design, independent of this pipeline).
  This is the decisive new evidence beyond W9: all three surfaces
  (execute, chain except by design, CTE) move together from ONE
  mutation to the shared dispatch convention -- the drift risk
  invariant (c) exists to rule out is now demonstrably closed, not
  merely value-equal.
  - First attempt at ④ (`SetOpStageBranches<TStage> = TStage extends
    never ? {...} : never`, intending "always resolves to the never
    branch") crashed `tsc` itself (`RangeError: Maximum call stack size
    exceeded` inside `instantiateTypeWorker`) -- a naked `extends
    never` check on a type parameter defers/re-enters TS's own
    conditional-type resolution indefinitely once `CteSetOpBranchProjection`'s
    recursive arm calls it. Diagnosed and abandoned in favor of the
    branch-substitution mutation above, which keeps the same `extends
    SetOpStage<infer P, infer L, infer R>` structural check (so
    recursion still terminates) and only corrupts the extracted
    triple's OUTPUT. A prior attempt swapping `left`/`right` outright
    was also tried and found VACUOUS (exit 0 both packages) --
    `SetOpResult`'s own fold is commutative (plain union), so swapping
    which side is "left" changes nothing observable at the type level;
    only substituting one branch's own value for the other (dropping
    real information) is a detectable mutation. Recorded as a fixture-
    design note, not a re-litigation of ③'s or ④'s own protocol scope.

**Serial gates (final, post-restore state):**
- `TURBO_FORCE=1 pnpm --filter @hejbro/core check-types` -- exit 0
- `TURBO_FORCE=1 pnpm --filter @hejbro/query check-types` -- exit 0
- `TURBO_FORCE=1 pnpm --filter @hejbro/core test` -- exit 0 (109 files
  / 2336 tests + 1 todo)
- `TURBO_FORCE=1 pnpm --filter @hejbro/query test` -- exit 0 (68 files
  / 1161 tests)
- `TURBO_FORCE=1 pnpm check` -- exit 0 (one `pnpm format` pass applied
  first; formatting drift from the repeated `git checkout --`/`git
  apply` mutation-restore cycles, 3 files, content unaffected; 3
  pre-existing warnings, unrelated file)
- `TURBO_FORCE=1 pnpm check-types` (repo-wide) -- exit 0, turbo 19/19
- `TURBO_FORCE=1 pnpm test` (repo-wide) -- exit 0, turbo `test` 19/19 +
  `test:types` 2/2 (the two subprocess-spawning `tsc`-in-suite files,
  isolated phase, per AGENTS.md's own count)
- `pnpm check:crap` -- exit 0 (no violations, 53 at the threshold, none
  from this task's own changed functions)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s), every
  delta title matches its base spec")

**Team-brief constant, recorded as directed:** sample-mutation-passing
is not coverage evidence, restated concretely -- ③'s own 4 quiet
nested cells would have read as "6/6 nested cells pass, nesting is
covered" from the green suite alone; only re-running the SAME kind of
mutation against the FINAL refactored code (not trusting an earlier
run against a since-changed file) surfaced that 4 of those 6 only
pass because their own fixture puts the wider side on the left of the
outermost fold, not because the recursion itself is exercised at that
step. Every mutation in this protocol was individually re-run against
the current, fully-refactored tree -- none reused a result carried
over from before the convention-promotion refactor.

<a id="w11"></a>
## W11 — 1.6: the delta names the cte-body surface -- verbatim text, gates

_2026-09-08T21:25Z_

Task 1.6 (the contract names the third surface) implemented verbatim
against the lead's own final consolidated text (planner: "확정 통합
본… 한 글자도 바꾸지 마세요"), on top of `2336e74d` (`widen-set-op-execute`
worktree). Diff: `openspec/changes/widen-set-op-execute/specs/
query-type-inference/spec.md`, `skills/hejbro/references/query-layer.md`.
No other file touched, per the task's own scope line.

**Six edits applied, each checked against the exact find/replace text
given (no paraphrase):**
1. ADDED requirement's own surface sentence gains the CTE-body clause
   (`spec.md`, the paragraph right before "A core-built stage carries
   both branch stages…").
2. New scenario appended at the end of the same ADDED requirement: "A
   set operation declared as a CTE body reads back as the union of its
   branches".
3. Scenario 4's own THEN ("A core-built set operation executed on a
   handle reads back as the union of its branches") gains the #1054
   residue sentence — verbatim, `#1053`/`#1055` cited nowhere.
4. `query-layer.md`: the stray `(#944)` citation removed from the
   recursive-CTE section's own set-op-stage aside (the requirement this
   change replaces already carried that citation away; this was the
   one place it survived in prose).
5. `query-layer.md`: a new paragraph after the `w.as` general
   description (before the code example) states the CTE-fold rule for
   a set-op entry.
6. `query-layer.md`: the chain's own set-operation section gains the
   #1054 residue sentence (int4/int8 promotion, values arrive
   unconverted) — the same text as edit 3's scenario, restated in
   prose for the reference doc's own readers.

**Line-number drift, not a content deviation.** The planner's own
"302–303행" pointer for edit 6 was computed against the file's
pre-edit-5 state; edit 5 inserts 8 lines earlier in the same file, so
by the time edit 6 ran the target text had moved. Located it by its
own content (`grep -n "rows arrive converted per the left branch"`)
instead of trusting the stale line numbers — the text itself, not its
position, is what the planner's instruction actually pins.

**One self-correction during edit 1.** A first pass left a spurious
blank-line paragraph break between the new sentence and the following,
already-existing sentence ("A core-built stage carries both branch
stages…") that the find/replace text was never meant to detach from —
the planner's replacement text is one sentence inserted into an
existing paragraph, not a new paragraph of its own. Caught by re-reading
the file immediately after the edit (not trusting the diff alone) and
fixed before running any gate.

**Serial gates (final state):**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (3 pre-existing warnings,
  unrelated file, unchanged from every prior task's own run)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0 (turbo 19/19)
- `TURBO_FORCE=1 pnpm test` -- exit 0 (turbo `test` 19/19 + `test:types`
  2/2)
- `pnpm check:crap` -- exit 0 (no violations, 53 at the threshold)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s), every
  delta title matches its base spec") -- the requirement's own title
  and the REMOVED block are byte-identical to before this task; only
  the ADDED requirement's own body and its scenario list changed,
  confirmed by re-reading the diff against this gate's own claim
  before trusting it.

<a id="w12"></a>
## W12 — review rework round 1: R1/R2/R3 -- transplant-cell mutation-red table

_2026-09-08T21:55Z_

Review round 1's rework pass (R1/R2/R3, `tasks.md`'s own "Review-born
rework, round 1" section) implemented and verified, on top of `2533d459`
(`widen-set-op-execute` worktree). Test text only, no production file
changed (confirmed via `git diff --stat` against every commit below).
Reviewer source: `/private/tmp/.../94642abb-.../scratchpad/
FINAL-zz-reviewer-query.test.ts` (read-only, per instruction).

**R1 (F2) -- two stale titles, `execute-result-type.test.ts`.** Raised a
clarifying question before touching anything: the block's two titles
quoted "A core-built set operation executed on a handle reads back as
its left branch" and "An object projection widens where the join record
is missing" -- both REMOVED (design.md Q4) and, on inspection, describing
behavior no current ADDED scenario names at all (the block pins a
hand-written, both-branches-unfilled `SetOpStage<Posts>`'s own
compatibility fallback, design.md Q2 -- not a live execution surface).
The lead ruled (A): quote `query-layer.md`'s own still-live 1.4 sentence
instead of a spec scenario, since a design-log citation goes untrackable
after archive and promoting the fallback itself to a spec scenario would
turn an implementation detail into a contract it was never meant to be.
Applied verbatim per the lead's own title pattern; the reference
sentence itself is quoted in a code comment so a future reader can find
the title's own basis inside the file. No mutation applies here (title
and comment only, test bodies byte-for-byte unchanged) -- verified by
`git diff` showing zero body-line changes, and both `check-types`/`test`
staying green throughout.

**R2 (F3) -- three parts, one commit.**

1. *Six execute-layer combinator cells, `execute-result-type.test.ts`.*
   Source: reviewer's "each combinator with the notNull branch on the
   LEFT (branch-drop detectable)" cell. The six cells here used to build
   `SetOpStage<Posts, FlatLeft, FlatRight>` with BOTH branches the exact
   same `SelectLimited<Posts, never>` -- vacuous, since a fold reads the
   same answer whether it runs or not against two identical branches.
   Replaced with `FlagLeft` (notNull) / `FlagRight` (nullable) -- the
   LEFT branch alone is notNull, so only reading the RIGHT branch can
   widen `flag` to nullable. Transplant gate: mutated `db.ts`'s own
   `SetOpExecuteRow` to fold left-only (the layer-isolation mutation, ②
   in 1.5b's own protocol) -- all six cells went red (lines 374, 382,
   390, 398, 406, 414), matching what M1/M6 killed in the reviewer's own
   table. Restored via `git diff > patch && git checkout -- db.ts` then
   `git apply patch` (never `git stash`); `check-types` clean again
   after.
2. *`orderBy()`/`limit()` branch-forwarding, `set-op-stage.types.test.ts`
   (new describe block, 3 cells).* NOT a port -- the reviewer's own such
   cell was measured vacuous (tasks.md's own note), so this one is
   written fresh against `LeftStageOf`/`RightStageOf` (the file's own
   existing extraction helpers). Tasks 1.1 and the proposal both state
   whole-set `orderBy`/`limit` forward both branch parameters unchanged;
   no cell anywhere pinned this claim before now. Transplant-equivalent
   gate (no original to reproduce, so a fresh mutation stands in):
   mutated `SetOpStage`'s own `orderBy`/`limit` return type to drop both
   branch parameters (`SetOpStage<TProjection>` alone, defaults). All
   three cells' six assertions went red (lines 140, 142, 148, 150, 156,
   157). Restored the same way.
3. *Four nested CTE cells, fixture-strengthened,
   `cte-set-op-fold.types.test.ts`.* The four cells 1.5b's own mutation
   ③ (with.ts-only, outermost-merge forced left-only) left quiet
   (left-nested x2, three-level x2, whole-table and object-projection)
   are traced to a genuine fixture-coincidence, not invented: each put
   the WIDER/divergent branch on the nested (inner) side, which sits on
   the OUTER combinator's own LEFT -- so an outermost-left-only bug
   never surfaces there, regardless of whether the recursion itself is
   correct. Re-declared so the inner chain stays single-valued
   throughout (no declared divergence introduced until the very last,
   outermost step, whose own RIGHT operand now carries it) --
   preserves the "left-nested"/"three-level" SHAPE (the nested stage is
   still the outer left operand), only the fixture's own value
   assignment moved. Re-ran mutation ③: all 6 nested cells now red
   (previously 2/6) -- lines 387, 406, 430, 454, 478, 509. Restored via
   the same diff/checkout/apply cycle; `check-types` clean.

**R3 (F4) -- four positions, one commit, `set-op-stage.types.test.ts`.**
Source: reviewer's "the compatibility gate survives the signature
rewrite (#487's own gap)" describe block, its four refusal cells (FIRST,
CHAINED, right-NESTED, reverse/LEFT-odd-one-out) ported verbatim -- only
the local fixture names changed (`posts`/`archivedPosts`/
`mismatchedRows` for the reviewer's `la`/`rb`/`mm`), matching this
file's own existing fixtures rather than importing the reviewer's. The
existing "a mismatched key set still fails" cell only pinned the FIRST
position; #487 is on record as the bug where the CHAINED position kept
the gap after the first was fixed, so a regression there specifically
needed its own pin, not an inference from the first cell. Transplant
gate: mutated `CompatibleSetOpBranch` (`select.ts`) to always resolve
`unknown` (the compatibility gate never refuses) -- all four new cells
went red (`@ts-expect-error` directives became "unused", TS2578: lines
194, 200, 206, 212), alongside the pre-existing first-position cell
(line 181) -- five total, matching the reviewer's own five-cell block
one-for-one. Restored the same way; `check-types` clean.

**A vacuous-mutation false start, R3 (recorded per the team-brief
constant on sample-mutation-passing not being coverage evidence).** The
first attempt at R3's own transplant gate swapped `SetOpStageBranches`'s
`left`/`right` fields outright (reusing 1.5b's own protocol ④ shape) --
zero reaction in either package, `check-types` clean under the
"mutation". Traced to `SetOpResult`'s own fold being commutative (a
plain union): swapping which side is "left" changes nothing observable
at the type level. Replaced with dropping one branch's own value
entirely (`right: TLeftStage`) for 1.5b's own W10 case, and with
`CompatibleSetOpBranch = unknown` for this task's own gate -- both
detectable. Not R3's own topic (R3 needed a compatibility-GATE mutation,
not a fold mutation), kept separate rather than reused.

**Serial gates (final state, after every mutation restored):**
- `TURBO_FORCE=1 pnpm check` -- exit 0 (one `pnpm format` pass applied;
  formatting drift from a manual patch-split -- see below -- landed as
  its own `style(core): ...` commit, since amending was not an option;
  3 pre-existing warnings, unrelated file)
- `TURBO_FORCE=1 pnpm check-types` -- exit 0, turbo 19/19
- `TURBO_FORCE=1 pnpm test` -- exit 0, turbo `test` 19/19 + `test:types`
  2/2 (`@hejbro/core` 109 files / 2343 tests + 1 todo, up from 2336;
  `@hejbro/query` 68 files / 1161 tests, unchanged count -- R2's own
  six-combinator fix replaced cells in place rather than adding new
  ones)
- `pnpm check:crap` -- exit 0 (no violations, 53 at the threshold)
- `pnpm check:modified-titles` -- exit 0 ("2 active change(s)")

**Mechanics note.** R2 and R3 both touch `set-op-stage.types.test.ts` in
non-overlapping hunks; split into two commits via `git diff` → two
hand-verified patch files → `git checkout --` + sequential `git apply`,
confirming the two patches together reconstruct the pre-split file
byte-for-byte before committing either half separately. One formatting
drift surfaced from this split (biome's own line-wrap preference
differs slightly depending on surrounding context at apply time) --
caught by the `check` gate, not silently carried forward; fixed via
`pnpm format` and landed as its own commit rather than folded into an
already-made one.

