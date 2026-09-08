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

