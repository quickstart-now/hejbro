# Tasks: harden-aggregate-vocabulary

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/expr/read-shape.ts` (new),
`packages/core/src/index.ts`, `packages/core/test/expr/read-shape.test.ts`
(new), `packages/cli/src/core-surface.ts` (1.1); `packages/core/src/
query/select.ts`, `packages/core/test/query/select.test.ts` (1.2);
`packages/query/src/db/convert.ts`, `packages/query/test/db/
nested-revive.test.ts` (1.3, 1.4); `packages/pg/test/integration.test.ts`,
`skills/hejbro/references/query-layer.md`, one `.changeset/*.md` (1.5);
`packages/query/test/db/execute.test.ts` (1.6).
If a task appears to need any other file, that goes back to the planner,
not into the diff.

**Ordering.** 1.1 first; 1.2 and 1.3 are independent after it; 1.4
needs both; 1.5 last. 1.6 is independent of all of them.

## 1. One read-shape vocabulary

- [x] 1.1 (~9m) **[design]** The vocabulary and its closure. Settles the
      export's name and row shape (`BUILDER_READ_SHAPES`, `Readonly<
      Record<BuilderFunctionName, "int8" | "argument" | "own">>`, with
      `BuilderFunctionName` the union the constructors already spell)
      and the enumeration the closure test uses. Red: `packages/core/
      test/expr/read-shape.test.ts` — an `it.each` over every aggregate
      and window constructor the barrel exports (`count`, `min`, `max`,
      `sum`, `avg`, `rowNumber`, `rank`, `denseRank`, `percentRank`,
      `cumeDist`, `ntile`, `lag`, `lead`, `firstValue`, `lastValue`,
      `nthValue`): invoke with a placeholder column ref where an
      argument is required, read the node's `functionName`, expect a
      row; a type-level case (`// @ts-expect-error`) that a
      `satisfies` over a union missing one name fails; the exports pin
      (`packages/cli/src/core-surface.ts`'s `ENGINE`, the
      `SELECT_CLAUSE_TRAVERSALS` precedent) gains the name. Files:
      `packages/core/src/expr/read-shape.ts`, `packages/core/src/index.ts`,
      `packages/core/test/expr/read-shape.test.ts`,
      `packages/cli/src/core-surface.ts`.

- [x] 1.2 (~8m) The cast side reads the table and unwraps a window
      node. Red: `packages/core/test/query/select.test.ts` (the file that
      pins `count()` → `::text` today, *"casts an at-risk aggregate cell
      in a nested read"*), an `it.each` over
      the table's rows × {unwindowed, windowed}: `int8` rows cast
      `::text`; `argument` rows over a `bigint` column cast `::text`
      and over a `text` column cast nothing; `own` rows cast nothing;
      `over(count(), …)` casts (the red that motivates the change).
      Green: `atRiskCastSuffix` reads `BUILDER_READ_SHAPES` through a
      window-unwrapping helper; `isCountCall`/`isPassthroughAggregateCall`
      retire. Files: `packages/core/src/query/select.ts`, the test.

- [x] 1.3 (~7m) The revive side reads the table. Red: `packages/query/
      test/db/nested-revive.test.ts` gains a table over the rows
      asserting the revived state per row (`int8` → `bigint` state;
      `argument` → the argument column's state; `own` → `undefined`),
      windowed and unwindowed; existing cases stay green byte-for-byte.
      Green: `BIGINT_FUNCTIONS`/`PASSTHROUGH_AGGREGATES` replaced by a
      lookup in `BUILDER_READ_SHAPES`. Files: `packages/query/src/db/
      convert.ts`, the test.

- [x] 1.4 (~7m) The drift guard becomes a ratchet. Red: the describe
      *"select.ts casts iff convert.ts revives"* rewritten as one
      `it.each` over `BUILDER_READ_SHAPES` × {windowed, unwindowed}
      through the existing `agreementFor` helper: `own` rows expect
      cast=false, revived=false; every other row expects both true —
      the windowed `count` row is red before 1.2 and green after. The
      three hand-written cases fold into the table. Files: `packages/
      query/test/db/nested-revive.test.ts`.

- [x] 1.5 (~10m) Live witness, docs, changeset. Red: `packages/pg/test/
      integration.test.ts`, new case *"a windowed cell in a nested read
      survives past 2^53"*: `over(count(), …)`, `over(max(col), …)`
      and `over(lag(col), …)` in a nested collection over a `bigint`
      column holding `9007199254740993`, delivered as exact `bigint`s;
      `over(sum(col), …)` arrives unconverted. Then `skills/hejbro/
      references/query-layer.md`'s nested-read paragraph states that
      windowed cells keep their precision like aggregates, and
      `pnpm changeset` → `patch`. Files: the witness, the reference,
      `.changeset/*.md`.

- [x] 1.6 (~5m) The preview-equals-executed claim covers the
      context-applied half too. Red: `packages/query/test/db/
      execute.test.ts`, new case *"executed SQL equals previewed
      compile output under an applied execution context"* — a statement
      that carries params, executed through a handle with a context
      applied: the statement the driver receives has `sql`, `params`
      and `kind` equal to `compile()`'s own output, and the context
      statements precede it inside the same transaction rather than
      altering it. Files: `packages/query/test/db/execute.test.ts`.
