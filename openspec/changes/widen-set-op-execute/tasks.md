# Tasks: widen-set-op-execute

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**No vacuous cell** (measured on this change, review round 1): a set-op
cell whose LEFT branch is already the widest reads the same type whether
the fold runs or not, so it passes a fold that was never wired. Every
surface therefore carries at least one cell whose RIGHT branch is
strictly wider — `#944`'s own case is that shape — and a mutation that
drops the fold has to redden it. Per surface, not per combinator: a
`SetOpStage` carries no operator, so a fold cannot branch on which
combinator built it (measured in review). Two independent input tables
(the implementer's and the reviewer's) both fell into this on the first
pass and only the mutation found it.

**Files edited**: `packages/core/src/query/select.ts` and its type tests
(1.1); `packages/query/src/db/db.ts` and `packages/query/test/` type
tests (1.2, 1.3); `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.4); `packages/core/src/query/with.ts` and its type
tests (1.5a, 1.5b), plus `packages/core/src/query/select.ts` and
`packages/query/src/db/db.ts` where 1.5b lifts the branch-carrying
convention into core for both consumers; the delta spec and the
reference again (1.6). If a task appears to need any other file —
`CteReference`'s own shape included — that goes back to the planner, not
into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5a → 1.5b → 1.6.

## 1. The core-built set operation types its union

- [x] 1.1 (~9m) **[design]** `SetOpStage` carries its branches. Settles
      the parameter order and defaults (`SetOpStage<TProjection,
      TLeftStage = unknown, TRightStage = unknown>`) and that
      `orderBy`/`limit` forward both. Red: `packages/core/test/query/
      set-op*.types.test.ts` — an input table over the six combinators ×
      {select ∪ select, setOp ∪ select, select ∪ setOp, three levels}
      asserting with `expectTypeOf` that the result's second and third
      parameters are the exact branch stage types, that a one-argument
      `SetOpStage<P>` still assigns, and that a mismatched key set still
      fails (`@ts-expect-error`, unchanged). Files: `select.ts`, tests.

- [x] 1.2 (~8m) `ExecuteResult` folds the branches, flat shapes. Red: the
      query type test — a table over {whole-table both sides (unchanged
      row); object projections with one column declared differently per
      side (union); a `notNull` column against a nullable one, in BOTH
      positions — a nullable RIGHT branch reading non-null is #944's own
      defect and is a cell of this table, not a corollary of the left
      one; a branch that left-joined the projected table (nullable)
      against one that inner-joined it (non-null → nullable in the
      result, never the reverse); a non-joined object projection (no
      longer widened to null); a hand-annotated `SetOpStage<P>` (today's
      fallback, which the branch defaults keep)}. Files: `db.ts`, tests.

- [x] 1.3 (~7m) The fold holds for every combinator and either nesting
      side. Red: the same query type test — a table over the six
      combinators (a fold wired for `union` alone passes 1.2's table
      unchanged) × {flat; `(a union b) except c`; `a except (b union
      c)`; three levels}, the join and nullability axes crossed in at
      least the nested cells. Files: `db.ts` if 1.2's minimal green does
      not already cover it, tests.

- [x] 1.4 (~5m) Reference and changeset. `query-layer.md`'s set-operation
      section replaces the core-built caveat with the approved
      paragraph; the recursive-CTE paragraph's rationale clause is
      corrected with its behavior sentence unchanged; the
      projection-versus-resolved-row distinction is stated once. Whether
      that section's `(#944)` citation goes or stays follows 1.2/1.3's
      measurement, not this task's judgement. `pnpm changeset` →
      `minor`. Files: the reference, `.changeset/*.md`.

- [x] 1.5a (~6m) A set operation used as a CTE body reads as the union
      too, flat. Measured after 1.4: `w.as("x", select(a).union(
      select(b)))` reads the CTE reference off the left branch's raw
      projection, so a column nullable only in the right branch reads
      non-null — #944's own defect on a value-level path the
      requirement's "on every surface" covers. Folding the composed
      projection is not the way: a merged object's field is a union of
      values from two different origin brands, which breaks the
      single-source `TableColumns` inference `CteRowEnvironment`'s
      whole-table arm does and collapses the field to `unknown`
      (measured). Instead each branch's environment is computed on its
      own — every branch is a single-source projection, the arm's own
      premise — and the two are merged per key, keyed off the
      environments (keying off the raw tables drags the `tableMeta`
      symbol into a position `CteFieldRef` refuses; measured). Red:
      `packages/core/test/query/` — a table over {right branch nullable
      (the #944 case); both notNull; left branch nullable; the six
      combinators} × {whole-table branches; object-projection branches}.
      Invariants, each pinned by a test rather than argued: the
      whole-table arm itself is not edited and non-set-op CTE entries
      read exactly as before; the merge agrees with `execute()`'s own
      fold for every key and on the key set itself (two-way `extends`
      against the `ExecuteResult` row — one folding rule, never a
      second); the runtime is untouched, since
      `buildCteRowEnvironment` already reads the left branch's
      `projectionInput` alone and that is the left-keys rule. Files:
      `with.ts`, tests.

- [x] 1.5b (~6m) The CTE fold recurses, and the recursive entry does not
      move. Red: the same test file — a table over {nested left; nested
      right; three levels} × {whole-table; object projection}. The
      recursive anchor/term path keeps its own rule (always widened,
      #942); its existing tests are the no-regression pin and must not
      be edited. The fold itself has one source — core's `SetOpResult`,
      which `@hejbro/query` re-exports and `db.ts` already folds through
      — so `with.ts` consumes that same type rather than restating a
      per-key union of its own; and the branch-carrying convention 1.1
      introduced (reading `SetOpStage`'s two branch parameters, and what
      an unfilled `unknown` branch means) is lifted into core so both
      consumers read one definition, since a convention kept in two
      places is repaired in one. Files: `with.ts`, `select.ts`, `db.ts`,
      tests.

- [x] 1.6 (~4m) The contract says the third surface. The delta's ADDED
      requirement gains the CTE-body scenario and names that surface in
      its own sentence; `query-layer.md` drops the `(#944)` citation and
      its `withCte` paragraph states the folded read. Every word of both
      is lead-approved before the commit. Files: the delta spec, the
      reference.

## Review-born rework, round 1

Overhead, not newly estimated work (the ledger rows carry a blank
estimate). Test text only — no production file changes. Every cell moved
here from the reviewer's own table carries its origin in a comment, and
lands only if **the mutation that reddened it there reddens it here**: a
cell's non-vacuity rides on its fixtures' divergence, so re-expressing it
against fixtures that do not diverge transplants the sentence and leaves
the guard behind.

- [x] R1 **F2 — two test titles quote a scenario this delta removes.**
      `packages/query/test/db/execute-result-type.test.ts` (the
      hand-annotated fallback block) names "A core-built set operation
      executed on a handle reads back as its left branch" and "An object
      projection widens where the join record is missing". The tests
      themselves are right; after the archive those names exist nowhere,
      so a reader takes them for live promises. Retitle to quote the
      ADDED scenario the block actually pins. Own commit.

- [x] R2 **F3 — the six-combinator cells are vacuous at the execute
      layer.** Measured: a fold wired for one operator survives them,
      because each cell puts the widest branch on the left. Reversed
      cells (notNull left) exist in the reviewer's table and redden under
      M1/M6. Same pass: the four nested CTE cells 1.5b left with the
      wider branch on the outer left (`(a∪b) except c`), and the
      `orderBy`/`limit` claim — tasks 1.1 and the proposal both state
      that whole-set `orderBy`/`limit` forward both branch parameters and
      **no cell anywhere pins it** (the reviewer's own such cell was
      measured vacuous).

- [x] R3 **F4 — the refusal is pinned at one position out of four.** The
      combinator signature was rewritten in 1.1 (`TOther`: projection →
      stage), and the mismatched-key-set refusal has a cell only at the
      first position. The comment beside it cites #487 — the bug where
      the chained position kept the gap after the first was fixed. The
      reviewer measured the guard holding at first, chained,
      right-nested and reverse; the three missing cells are regression
      pins, not fixes.
