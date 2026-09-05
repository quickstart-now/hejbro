# Tasks: harden-recursive-nullability

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/query/with.ts` and the core CTE
type tests (1.1); `packages/query/src/db/chain.ts`, `packages/query/src/
types/set-op.ts` if the chain's widening lives there, and the query CTE
type tests (1.2); `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.3). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3.

## 1. Outward nullability

- [ ] 1.1 (~10m) **[design]** The core builder widens the outward row.
      Settles the widening type (`WidenNullability<TAnchor, TRecursive>`:
      per key, `TAnchor[K] | (null extends TRecursive[K] ? null : never)`
      expressed without a ternary in source — a mapped conditional type
      is a type, not a ternary expression) and where it lands
      (`asRecursive`'s outward `CteReference`). Red: the core CTE type
      test file, an `expectTypeOf` table: {anchor non-null, recursive
      nullable → outward nullable; inner reference non-null}, {both
      non-null → non-null}, {anchor nullable, recursive non-null →
      nullable}, {recursive projects the key through a window function →
      nullable, as `ProjectedColumnResult` already types it}, {two keys,
      one widened, one not}. Files: `with.ts`, its type tests.

- [ ] 1.2 (~8m) The chain form widens identically. Red: the query
      package's CTE type tests, the same table through
      `handle.with(...)`'s recursive form, plus one execution through a
      recording driver where the recursive term's row carries `null`:
      the delivered value is `null` and the row type admits it. Files:
      `chain.ts` (and `types/set-op.ts` if shared), tests.

- [ ] 1.3 (~6m) Docs and changeset. The CTE section of `query-layer.md`
      states "type from the anchor, nullability from either branch";
      `pnpm changeset` → `patch`. Files: the reference, `.changeset/*.md`.
