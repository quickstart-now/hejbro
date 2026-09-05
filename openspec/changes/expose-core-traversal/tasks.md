# Tasks: expose-core-traversal

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/index.ts`, `packages/core/src/expr/
expr-children.ts`, `packages/core/test/exports.test.ts`,
`packages/core/test/expr/expr-children.test.ts`, `packages/cli`'s barrel
classification list and its test (1.1); `packages/query/src/compile/
params.ts` and its tests (1.2); `packages/supabase/src/validators/
rls-uncached-auth-call.ts`, `packages/supabase/src/storage/
bucket-kind.ts`, `examples/preset-smoke/src/preset.ts` and their tests
(1.3); `skills/hejbro/references/extension-interface.md`, one
`.changeset/*.md` (1.4). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 and 1.3 (independent) → 1.4.

## 1. Extension surface

- [x] 1.1 (~7m) **[design]** The five exports. Settles the names as they
      exist (`exprChildren`, `replaceExprChildren`, `requireNext`,
      `requirePrevious`, `requireBoth`) and their tsdoc as extension
      surface. Red: `packages/core/test/exports.test.ts` pins the five;
      `hejbro`'s classification test lists them as engine and its
      barrel-absence test names them beside `SELECT_CLAUSE_TRAVERSALS`.
      Files: `packages/core/src/index.ts`, `expr/expr-children.ts`'s
      registry tsdoc — it records the table as deliberately not
      exported, the constraint this change reverses (515/R2) — the two
      pins, and `test/expr/expr-children.test.ts`'s #473 pin, inverted
      rather than deleted (515/R4).

- [x] 1.2 (~9m) The parameter lifter folds. Red: the params tests gain
      an input table over every node kind the registry knows (one
      expression per position, a literal in each), asserting the lifted
      SQL and parameter order are byte-identical before and after the
      fold — the table is what proves no position was lost. Green:
      `liftExprNode` walks `exprChildren` and rebuilds through
      `replaceExprChildren`; the per-kind handler table is deleted.
      Files: `params.ts`, its tests.

- [x] 1.3 (~9m) The preset sites fold. Red: the RLS validator's tests
      gain the same per-position table (an `auth.uid()` call in each
      position is found); the bucket kind's and the example kind's tests
      pin `invalid-kind-change` for a change missing the needed side,
      the folded guard naming the change by its kind token (515/R2), so
      the bucket kind's two existing message pins move to that wording.
      Green: `ChildrenOfHandlers` becomes `exprChildren`; the two inline
      guards become the helpers. Files: the three sources, tests.

- [x] 1.4 (~5m) Docs and changeset. `extension-interface.md` gains the
      five names with one sentence each; `pnpm changeset` → `minor`.
      Files: the reference, `.changeset/*.md`.
