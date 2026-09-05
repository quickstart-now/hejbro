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

<a id="w2"></a>
## W2 — Task 1.4: review repair -- set-op exception and nested-read widening

_2026-09-05T15:06Z · per R6, R7_

Review repair after the group-1 review (R6, R7):

- `packages/query/src/types/select-result.ts`: `NestedOrExprResult` split
  into `DirectNestedOrExprResult` (the pre-existing nested-read/column
  logic, unchanged) and a new top-level `NestedOrExprResult =
  DirectNestedOrExprResult | RecursiveNullWidening<TValue>`, so a
  nested-read key now also unions in the recursive term's widening
  (review B2). `RecursiveNullWidening` resolves the recursive term's own
  carried value through `DirectNestedOrExprResult`, not
  `DirectProjectedColumnResult` directly, so a `jsonArrayFrom` recursive
  value (renders `coalesce(json_agg(...), '[]')`, structurally never
  null) is not falsely read as nullable (review E7/E11). One layer only:
  the widening never re-enters itself.
- No change to `packages/core/src/query/with.ts`: the lead's first R6
  instruction (carry `never` for a `SetOpStage` recursive term) was
  executed, found unsound by the reviewer (an untracked left-joined set
  is UNKNOWN, not empty; `never` would drop a real left join hiding
  inside a set-op branch), and withdrawn -- `with.ts` reverted to its
  pre-1.4 committed state (`654991cd`), `UntrackedJoins` stays the
  set-op recursive term's own carried set, unchanged since R3.
- `packages/query/test/types/select-result.test.ts`: nine regression
  rows -- R32, F1, E2, E4, E5, E6, E7, E11a, E11c -- six expecting null
  (R32, F1, E2's ordinary key, E4, E5, E6) and three expecting non-null
  (E2's nested-read key, E7, E11a, E11c), since a null-only table cannot
  catch over-widening. Measured directly (not assumed): reverting only
  `select-result.ts` and re-running `tsc` showed E4, E6 and E11a red
  before the fix and E2, E5, E7, E11c, R32, F1 already green -- narrower
  than the review's own predicted red set, because a nested-read key
  was already immune to widening entirely before this fix (the B2 bug
  itself), not selectively over-widened.
- `skills/hejbro/references/query-layer.md`, `openspec/changes/
  harden-recursive-nullability/{proposal,design}.md` and the delta's
  spec: the set-op exception stated explicitly, and "the same per-key
  union a plain set operation's result already has" (false -- a plain
  set operation keeps the left branch's own projection) corrected
  throughout (review N1); the gap that comparison revealed is the
  lead's new issue #944.
- Recorded, not fixed (no issue filed, per lead): `json()`/`jsonb()`
  columns read as `unknown` regardless of `notNull` -- a pre-existing,
  fail-safe (never a lie) imprecision orthogonal to this change's own
  axis. Reproduction: `/private/tmp/review-rn-scratch/reviewer-inputs/
  rn-e10.test.ts` (E10a-c).

Gates: `pnpm build --force`, `tsc --noEmit` for core/query/pg, full
`packages/query` vitest suite (1046 tests), `pnpm biome check` on all
changed files -- all pass. Full 12-gate suite run separately, logged.

Actual time: 75m against a 14m estimate. The overrun is the review
churn itself (R6 issued as `never` then withdrawn on soundness grounds,
B2 found mid-implementation, E7/E8 found isolating the fix, E8 replaced
by E11a after the reviewer's own correction) -- the lead's rework cost,
not a misestimate of the settled contract's own size.

<a id="w3"></a>
## W3 — Task 1.4 finalized: reviewer's E11/E12/E2u classification, red confirmed

_2026-09-05T15:27Z · per R6, R7, R8_

Follow-on to W2 after the reviewer's own reclassification round
(E6 dropped as the same input class as E4; E8 replaced by E11a/E11c/E11b
as a measurement artifact -- json/jsonb read `unknown` regardless of
`notNull`; E2 replaced by E2u, stated over `unionAll` since `union`
over a `json` column is refused by Postgres, "could not identify an
equality operator for type json"; E12 added -- anchor an array read,
recursive term an object read for the same key).

Final regression table, ten rows: six expecting null (R32, F1, E4, E5,
E6 dropped -> not restated, E12) -- corrected: five expecting null
(R32, F1, E4, E5, E12) and four expecting non-null (E7, E11a, E11c,
E2u), plus the non-recursive pin. Re-measured directly by swapping in
the pre-R7 `select-result.ts` and re-running `tsc`: red is exactly
{E4, E11a, E12}, green already is exactly {R32, F1, E5, E7, E11c, E2u,
the non-recursive pin} -- matches the reviewer's own final classification
verbatim, no rows moved by this implementer's own judgment.

No further code change: `select-result.ts` is unchanged from W2 (the
R7 fix already covers all three red rows). `with.ts` reconfirmed
identical to `4dd9b9fb` (no diff). The delta's exception clause and the
skill's CTE sentence both restated in the exclusive form (R8): a key a
set-op recursive term projects from a column or a non-nested-read
expression reads nullable (untracked); a key it projects through a
nested read follows that read's own rule instead.

Total actual time for task 1.4 across both rounds: 95m against a 14m
estimate, entirely review churn (R6 issued as `never`, withdrawn;
E6/E8 reclassified to E2u/E11/E12 after the reviewer's own
self-corrections) -- the lead's rework cost, recorded in
task-times.csv.

