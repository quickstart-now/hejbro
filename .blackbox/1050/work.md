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

