# Tasks: add-aggregate-filter

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands after `harden-aggregate-vocabulary` merges.

**Files edited**: `packages/core/src/expr/{ast,aggregate,render-sql,
codec,expr-children,retarget,walk,read-shape}.ts`, `packages/core/src/
query/select.ts`, `packages/core/src/index.ts`, `packages/core/test/expr/
reachable-kinds.ts` and the tests beside each (1.1–1.3); `packages/query/
src/compile/params.ts`, `packages/query/src/db/convert.ts` and tests
(1.4); `skills/hejbro/references/query-layer.md`, one `.changeset/*.md`
(1.5). If a task appears to need any other file, that goes back to the
planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5.

## 1. FILTER (WHERE …)

- [ ] 1.1 (~10m) **[design]** The node and the wrapper. Settles
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
      fixture produces one). Files: `ast.ts`, `aggregate.ts`,
      `reachable-kinds.ts`, `index.ts`, tests.

- [ ] 1.2 (~9m) Render, encode, decode. Red: the render tests — the
      table from 1.1 renders `<name>(…) filter (where …)` and, windowed,
      `… filter (where …) over (…)`; the codec tests — round trip through
      a view body, token `aggregate-filter`, and a stored node missing
      `where` or `fn` is refused naming the corruption. Files:
      `render-sql.ts`, `codec.ts`, tests.

- [ ] 1.3 (~8m) Walk, retarget, children, read shape. Red: the
      expr-children/retarget/walk tests — a rename of the table inside
      the condition retargets it; `exprChildren` yields the call and the
      condition; the read-shape lookup unwraps a filtered call to its
      inner call so `atRiskCastSuffix` casts `filter(count(), …)` inside
      a nested read. Files: `expr-children.ts`, `retarget.ts`, `walk.ts`,
      `read-shape.ts`, `query/select.ts`, tests.

- [ ] 1.4 (~8m) The query package. Red: `params.test.ts` — a literal
      inside the filter condition is lifted to `$n` in order; the nested
      revive ratchet row for a filtered `count`/`max`/`sum` (cast ⇔
      revive, `own` for `sum`). Files: `params.ts`, `convert.ts`, tests.

- [ ] 1.5 (~5m) Docs and changeset. `query-layer.md`'s aggregate
      section shows `filter` and its composition with `over`; `pnpm
      changeset` → `minor`. Files: the reference, `.changeset/*.md`.
