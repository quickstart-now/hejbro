# Tasks: harden-set-op-families

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands in either order with `widen-set-op-execute`
(shared file `query/select.ts`, different regions — rebase, no merge
conflict expected).

**Files edited**: `packages/core/src/query/select.ts`, `packages/core/
src/query/with.ts`, `packages/core/test/query/*set-op*-types.test.ts`
and the recursive-term type test (1.1, 1.2); `packages/query/test/
*types*.test.ts` (1.2); `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.3). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3.

## 1. Family agreement

- [x] 1.1 (~10m) **[design]** The measured pair table. On a
      `postgres:17` container, for every ordered pair of the ten
      concrete families (`uuid text numeric boolean datetime interval
      json bytea net array`), run one `union` of two typed literals and
      record refused (`42804`) vs unified; also each family against an
      untyped literal (the `"unknown"` wildcard claim). Vendor the
      matrix as a literal in `select.ts` (a `readonly` record keyed by
      family, the constraint stated in one comment line) and the
      reproduction SQL plus server version in design.md. Red: the type
      test's enumeration — every member of `sqlTypeFamilies` except
      `"unknown"` has a row, and the row count equals the matrix size
      (a family added without a row fails). Files: `select.ts`, tests,
      design.md.

- [ ] 1.2 (~10m) The rule on three surfaces. Red: an input table over
      {every refused pair from 1.1 → `@ts-expect-error` at the
      combinator's parameter; every unified pair → accepted; `"unknown"`
      on the left, on the right, on both → accepted; same family both
      sides → unchanged result type} × {core `union`, chain `.union()`,
      recursive anchor/term}, plus a within-family row (`int` vs
      `bigint`) that stays accepted with a comment pointing at #489.
      Green: `SetOpResult` folds the family test over the key set;
      `with.ts`'s compatibility test gains nothing but inherits it.
      Files: `select.ts`, `with.ts`, tests.

- [ ] 1.3 (~5m) Reference and changeset. `query-layer.md`'s
      set-operation and recursive-CTE sections state the family rule,
      the wildcard and the within-family limit; `pnpm changeset` →
      `minor`. Files: the reference, `.changeset/*.md`.
