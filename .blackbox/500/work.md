# Work — quickstart-now/hejbro#500

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Group 1: outward nullability widening for recursive CTEs

_2026-09-05T13:47Z · per D24, D25, R1, R2, R3, R4, R5_

Implemented across five tasks (1.1, 1.1b, 1.2, 1.2b, 1.3):

- `packages/core/src/query/with.ts`: `widenedByBrand`/`WidenedBy<TRecursiveValue,
  TRecursiveLeftJoined>` (a phantom brand, tuple-encoded so both type
  parameters are recovered by a single `infer`), `RecursiveCteReference<
  TProjection, TRecursiveProjection, TRecursiveLeftJoined>`. `asRecursive`'s
  outward reference intersects `WidenedBy` onto every key; `TRecursiveLeftJoined`
  is inferred from the stage the recursive callback returns (named generic
  matching, the same channel `@hejbro/query`'s chain factories already use for
  their own `TLeftJoined`). The reference the recursive callback itself
  receives is unchanged (plain `CteReference`).
- `packages/query/src/types/select-result.ts`: `DirectProjectedColumnResult`
  (the pre-existing logic, renamed), `WidenedRecursivePair`, `RecursiveNullWidening`,
  and `ProjectedColumnResult = DirectProjectedColumnResult | RecursiveNullWidening`.
  Resolves `ProjectedColumnResult<TRecursiveValue, TRecursiveLeftJoined>`
  recursively and unions `null` in when that resolves nullable.
- `packages/query/test/db/chain.test.ts`: one execution through a recording
  driver proving the recursive term's `null` is delivered and the row type
  admits it, plus a pinned `expectTypeOf` equality between `handle.with(build)`'s
  and `withCte(build)`'s row types (same `build` reference for both calls).
  `packages/query/src/db/chain.ts` needed no source change.
- `skills/hejbro/references/query-layer.md`: one paragraph in the CTE section
  stating the rule and citing #942 (the separate, pre-existing boundary that
  keeps it invisible on `handle.with(...)` today).
- `packages/cli/src/core-surface.ts`: `widenedByBrand` classified `ENGINE`
  (#500/R5), fixing `packages/cli/test/exports.test.ts`'s barrel-curation
  check (#471), which failed once the new core export existed.
- `.changeset/harden-recursive-nullability.md`: one `patch` changeset.

Measured: 20 core tests (`with-recursive.test.ts`), 43 query type tests
(`select-result.test.ts`), 32 chain tests (`chain.test.ts`) all pass;
`packages/query` full suite 1034->1036 tests pass; `packages/pg` and the
whole workspace's `check-types` (19/19) show no regression, including the
pre-existing left-join recursive term in
`packages/pg/test/integration.test.ts` ("depthGuarded", line ~2496-2508),
whose own outward type now widens to nullable as this change intends.

Actual task time: 1.1 6m, 1.1b 5m, 1.2 13m (an untracked-default discovery
in `db.with(...)`'s own row-type default forced a mid-task re-design,
settled as #500/R4), 1.2b 3m, 1.3 3m — against 6/6/7/6/6m estimated.

