# Tasks: add-aggregates

One group: the node fields, the vocabulary, the stages, the read-type
brand and its conversion are one feature, and the tree does not
type-check between any two of them. Estimates are pure work minutes
(D88).

## 1. Aggregating and grouping

- [x] 1.1 (~8m) [design] The aggregate vocabulary + a `ReadAs<T>` phantom
      brand. The [design] part is which aggregates carry a brand:
      `count` does (it is `int8` whatever it counted), `min`/`max` do not
      (returning the argument's own type is strictly more precise —
      it can even carry a declared column's origin), `sum`/`avg` do not
      (Postgres promotes them by the argument's exact type). Red:
      `packages/core/test/query/select.test.ts` — "renders count,
      count(expr), min/max, sum and avg". Files:
      `packages/core/src/expr/aggregate.ts`,
      `packages/core/src/index.ts`, that test.
- [x] 1.2 (~8m) `SelectNode.groupBy`/`having`, their rendering in SQL's
      clause order, and their codec entries. Red: same file — "renders
      group by and having in SQL's own order". Files:
      `packages/core/src/expr/{ast,render-sql,codec}.ts`, that test.
- [x] 1.3 (~7m) [design] The stages: `groupBy` after `where`, `having`
      only after `groupBy`, `orderBy`/`limit`/`offset` still after
      `having`. The [design] part is that last one — the first attempt
      returned the stage that has `limit` but not `orderBy`, which would
      have made `group by … order by` inexpressible. Files:
      `packages/core/src/query/select.ts`,
      `packages/query/src/db/chain.ts`, `packages/core/src/index.ts`.
- [x] 1.4 (~7m) The read-type brand reaches the result type, and the
      conversion path synthesizes the matching column state so the value
      matches the type. Red:
      `packages/query/test/types/select-result.test.ts` — "count reads
      as bigint", "min and max keep the argument's own declared type",
      "sum and avg stay at the family's widest honest type". Files:
      `packages/query/src/types/select-result.ts`,
      `packages/query/src/db/convert.ts`, that test.
- [x] 1.5 (~10m) Snapshot shape: goldens regenerated and both example
      chains replayed (snapshot + every migration's two banner hash
      lines). Format 8 is extended in place, not bumped — see the
      proposal. Files: `packages/core/test/golden/**`, `examples/**`.
- [x] 1.6 (~8m) Live witness against postgres:17: `having` keeps exactly
      one group, `count` arrives as a `bigint` and not the text the
      driver hands back for `int8`, and `max` carries the argument's
      declared mode. Verified load-bearing by asserting `typeof` is
      `"string"` — which fails. Files:
      `packages/pg/test/integration.test.ts`.
- [x] 1.7 (~6m) `skills/hejbro/references/query-layer.md`: an aggregates
      section with the per-aggregate type table and its reasons, and the
      "not supported" list narrowed to window functions and CTEs.
      Changeset (D59, `minor`), task times, README badges.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` clean.
- `pnpm --filter @hejbro/pg test:integration` 8/8 live against a real
  postgres:17.
