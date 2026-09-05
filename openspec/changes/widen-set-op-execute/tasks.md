# Tasks: widen-set-op-execute

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/query/select.ts` and its type tests
(1.1); `packages/query/src/db/db.ts` and `packages/query/test/` type
tests (1.2); `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.3). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3.

## 1. The core-built set operation types its union

- [ ] 1.1 (~9m) **[design]** `SetOpStage` carries its branches. Settles
      the parameter order and defaults (`SetOpStage<TProjection,
      TLeftStage = unknown, TRightStage = unknown>`) and that
      `orderBy`/`limit` forward both. Red: `packages/core/test/query/
      set-op*.types.test.ts` — an input table over the six combinators ×
      {select ∪ select, setOp ∪ select, select ∪ setOp, three levels}
      asserting with `expectTypeOf` that the result's second and third
      parameters are the exact branch stage types, that a one-argument
      `SetOpStage<P>` still assigns, and that a mismatched key set still
      fails (`@ts-expect-error`, unchanged). Files: `select.ts`, tests.

- [ ] 1.2 (~10m) `ExecuteResult` folds the branches. Red: the query type
      test — a table over {whole-table both sides (unchanged row);
      object projections with one column declared differently per side
      (union); a `notNull` column vs a nullable one (nullable); a branch
      that left-joined the projected table (nullable) against one that
      inner-joined it (non-null → nullable in the result, never the
      reverse); a non-joined object projection (no longer widened to
      null); `(a union b) except c`; a hand-annotated `SetOpStage<P>`
      (today's fallback)}. Files: `db.ts`, tests.

- [ ] 1.3 (~5m) Reference and changeset. `query-layer.md`'s set-operation
      section drops the core-built caveat and states the one rule; `pnpm
      changeset` → `minor`. Files: the reference, `.changeset/*.md`.
