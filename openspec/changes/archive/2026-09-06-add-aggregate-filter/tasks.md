# Tasks: add-aggregate-filter

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands after `harden-aggregate-vocabulary` merges.

**Files edited**: `packages/core/src/expr/{ast,aggregate,window,
render-sql,codec,expr-children,retarget,walk,read-shape}.ts` (1.1–1.3
as each task names them), `packages/core/src/
query/select.ts`, `packages/core/src/index.ts`, `packages/core/test/expr/
reachable-kinds.ts` and the tests beside each (1.1–1.3); `packages/query/
src/compile/params.ts`, `packages/query/src/db/convert.ts` and tests
(1.4); `packages/supabase/src/validators/rls-uncached-auth-call.ts` and
its test (the child-traversal table restated outside core, waived onto
this change because the package stops compiling without it);
`skills/hejbro/references/query-layer.md`, `packages/cli/src/{index,
core-surface}.ts`, one `.changeset/*.md` (1.5). If a task appears to
need any other file, that goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5.

## 1. FILTER (WHERE …)

- [x] 1.1 (~10m) **[design]** The node and the wrapper. Settles
      `AggregateFilterNode { nodeKind: "aggregateFilter"; fn:
      FunctionCallNode; where: ExprNode }`, the widened `WindowNode.fn`,
      `filter(target, condition)`'s signature (returns `target`'s own
      type) and `filter-not-aggregate`'s message. Red: `packages/core/
      test/expr/aggregate*.test.ts`, a table over the five aggregates ×
      {plain, windowed via `over(filter(…))`} asserting the node shape
      and the projected type (`expectTypeOf`), and a refusal table
      {columnRef, `sql\`1\``, a schema-qualified call, `rowNumber()`,
      `over(count(), spec)`} → `filter-not-aggregate`; the D70
      completeness fixture gains the kind (the assertion is red until a
      fixture produces one). The `fn` slot widens in two places that must
      move together: `ast.ts`'s type and `window.ts`'s own runtime guard
      (`overAggregate` admits an aggregate-filter node, `buildWindowNode`
      takes the widened slot, `invalid-over-target` says so). Files:
      `ast.ts`, `aggregate.ts`, `window.ts`, `read-shape.ts`,
      `reachable-kinds.ts`, `index.ts`, tests.

- [x] 1.2 (~11m) Render, encode, decode, children. Red: the render tests
      — the table from 1.1 renders `<name>(…) filter (where …)` and,
      windowed, `… filter (where …) over (…)`; the codec tests — round
      trip through a view body, token `aggregate-filter`, and a stored
      node missing `where` or `fn` is refused naming the corruption;
      the expr-children test — `exprChildren` yields the call and the
      condition. `exprChildren` belongs here, not to 1.3: `render-sql.ts`'s
      own `collectColumnRefs` calls it on the render path, so a view
      carrying a filtered aggregate cannot render at all until the
      traversal registry knows the kind. Files: `render-sql.ts`,
      `codec.ts`, `expr-children.ts`, tests.

- [x] 1.3 (~6m) Walk, retarget, read shape. Red: the retarget/walk tests
      — a rename of the table inside the condition retargets it; the
      read-shape lookup unwraps a filtered call to its inner call so
      `atRiskCastSuffix` casts `filter(count(), …)` inside a nested read.
      `retarget.ts` needs no source change — its generic fallback walks
      through `exprChildren`, which learned the kind in 1.2 — so its
      scenario lands as a pin that was green on arrival, recorded as
      such. Files: `walk.ts`, `read-shape.ts`, `query/select.ts`, tests
      (`retarget.test.ts` included).

- [x] 1.4 (~8m) The query package. Red: `params.test.ts` — a literal
      inside the filter condition is lifted to `$n` in order; the nested
      revive ratchet row for a filtered `count`/`max`/`sum` (cast ⇔
      revive, `own` for `sum`). Files: `params.ts`, `convert.ts`, tests.

- [x] 1.5 (~8m) Docs, the user-facing barrel, and the changeset.
      `query-layer.md`'s aggregate section shows `filter` and its
      composition with `over`, importing it from `hejbro` the way a user
      does; `pnpm changeset` → `minor`. `filter` is user surface, so it
      belongs to the `hejbro` package's vocabulary: without the value
      re-export it exists only as a type there, and both the snippet
      compile test and the barrel curation gate (#471) are already red.
      Files: the reference, `.changeset/*.md`,
      `packages/cli/src/{index,core-surface}.ts` (and
      `packages/cli/test/exports.test.ts` only if it asks for one).
