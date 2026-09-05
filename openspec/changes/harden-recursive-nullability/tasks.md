# Tasks: harden-recursive-nullability

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Where nullability is decided** (lead ruling, #500/R2): in
`@hejbro/query`'s `ProjectedColumnResult` alone — the one place that
already knows a projected value's null dimension, left joins included.
The core builder does not re-derive it: `asRecursive`'s outward
reference only *carries* the recursive term's projected expression per
key, and the query layer resolves both sides and unions the null. A
second copy of the rule in core would be a proper subset of that
knowledge (a recursive term projecting a left-joined table's non-null
column reads nullable in query, non-null in the copy) and would widen
too little — the lying type this change exists to remove.

**Files edited**: `packages/core/src/query/with.ts` and the core CTE
type tests (1.1); `packages/query/src/types/select-result.ts` and the
query CTE type tests (1.2), the query execution test (1.2b);
`skills/hejbro/references/query-layer.md`, one `.changeset/*.md` (1.3).
`packages/query/src/db/chain.ts` is expected to need **no source
change** — `ChainApi.with` takes core's own `CteBuilder` and resolves
rows through `SelectResult`, so the widening reaches the chain
structurally — and it is the only further source file this change may
touch if that expectation fails. If a task appears to need any other
file, that goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.2b → 1.3.

## 1. Outward nullability

- [ ] 1.1 (~6m) **[design]** The core builder carries the recursive
      term's projection outward. Settles the carrier type
      (`WidenedBy<TRecursiveValue>`: a phantom brand, never assigned at
      runtime, intersected per key onto the outward reference's field —
      the `columnOriginBrand`/`readAsBrand` precedent) and where it
      lands (`asRecursive`'s outward `CteReference`, every key, not a
      selected subset: which keys widen is the query layer's decision,
      not core's). Red: the core CTE type test file, a structural table
      — {every outward key carries `WidenedBy<the recursive term's
      projected value for that key>`}, {the reference the recursive
      callback receives carries none}, {the outward reference is still
      assignable to `FromSource`, i.e. `select({ … }, r)` still
      type-checks and `r.k`'s `exprNode` is still `ColumnRefNode`}.
      Row nullability is **not** asserted here (it is not observable in
      core — see the ruling above); 1.2 owns it. Files: `with.ts`, its
      type tests.

- [ ] 1.2 (~7m) The query layer widens the outward row. Red: the query
      package's CTE type tests, an `expectTypeOf` table through
      `handle.with(...)`'s recursive form — {anchor non-null, recursive
      nullable → outward nullable; the reference inside the recursive
      callback non-null}, {both non-null → non-null}, {anchor nullable,
      recursive non-null → nullable}, {the recursive term projects the
      key through a window function → nullable — a **regression guard**,
      not evidence of the widening: `over(...)` already fails
      `IsDirectColumnRef`, so `ProjectedColumnResult` types it nullable
      today}, {two keys, one widened, one not}, {**the recursive term
      projects a left-joined table's non-null column → outward
      nullable**} — the last row is why the rule lives here and not in
      core. Files:
      `types/select-result.ts`, tests.

- [ ] 1.2b (~6m) The delivered value and the chain surface agree. Red:
      one execution through a recording driver where the recursive
      term's row carries `null` — the delivered value is `null` and the
      row type admits it — plus a pinned assertion that the chain form
      (`handle.with(...)`) and the core builder produce the identical
      row type, since the chain reuses core's `CteBuilder` rather than
      restating it. If `chain.ts` needs no source change, this task
      lands as tests only and says so. Files: the query execution test.

- [ ] 1.3 (~6m) Docs and changeset. The CTE section of `query-layer.md`
      states "type from the anchor, nullability from either branch";
      `pnpm changeset` → `patch`. Files: the reference, `.changeset/*.md`.
