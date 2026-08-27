# Tasks: harden-query-layer

Groups are parallel-safe slices (no file overlap; the two [design]
tasks are settled with the owner before any group is summoned, per the
established pre-settlement discipline). Dependency order: 1/2/3 are
mutually parallel. Estimates are pure work minutes calibrated on
`openspec/task-times.csv` (approx rows discounted). A task is done when
its named red test passes plus `pnpm check`/`check-types` on the
touched package. Established execution standards apply as hard rules:
every gate run uses `TURBO_CACHE_DIR="$PWD/.turbo/cache-<tag>"` +
`--force` citing `Cached: 0`; review targets are single frozen SHAs
(freeze handshake); mutation verdicts pass the 3-step validity
protocol; a refactor commit carries an inventory of the contract axes
it creates; every spec sentence traces to a named test; each group gets
its GitHub tracking issue before its team is summoned (In Progress at
summon, closed explicitly at merge — Closes-keywords do not fire on
dev). Group 1 and group 2 both touch `packages/query/types` files —
the split is by FILE, not by topic: group 1 owns `array-text.ts`
(new) and `convert.ts`; group 2 owns `interval.ts` (serialization
append) and the compile/lift files; neither touches the other's list.
`pnpm-lock.yaml` conflicts (none expected — no dependency changes) and
the README CRAP block stay lead-owned at close.

## 1. Array conversion + driver override (#320, #323)

- [ ] 1.1 Pure Postgres array-literal text parser: quoted elements,
  escaped quotes/backslashes, `NULL` elements, empty array; unparsable
  text throws a kebab-coded enriched `Error` (never a partial array);
  red test `packages/query/test/types/array-text.test.ts` "parses
  quoted, escaped, and NULL elements; rejects unparsable text whole";
  files `packages/query/src/types/array-text.ts`. ~10m
- [ ] 1.2 Element-wise conversion wiring: `convert.ts` routes array
  columns (declared `typeName: "array"`) through per-element
  conversion — moded numeric/bigint arrays map the driver's text-element
  array; `interval[]` goes raw array text → 1.1 parser → per-element
  interval parse; `NULL` elements pass as `null`; element failure =
  the existing `result-conversion-failed` naming the column; red test
  `packages/query/test/db/convert.test.ts` "moded and interval array
  cells convert element-wise; a poisoned element names its column";
  files `packages/query/src/db/convert.ts`. ~10m
- [ ] 1.3 `@hejbro/pg` override extends to oid 1187: interval arrays
  arrive as raw array text (delegation for every other oid unchanged —
  the existing two-argument delegation witnesses stay green); red test
  `packages/pg/test/driver.test.ts` "interval array reaches the row as
  raw array text while other array oids keep pg defaults"; files
  `packages/pg/src/driver.ts`. ~8m
- [ ] 1.4 Late-bound hook at checkout (#323): the checkout guard calls
  `driver.setupSession` (property, not the captured closure), so a
  wrapped hook takes effect; the per-driver guard scope promised in
  tsdoc gets its test; existing pin scenarios stay untouched-green;
  red test `packages/pg/test/driver.test.ts` "a wrapped setupSession
  member runs at checkout; guard scope is per driver value"; files
  `packages/pg/src/driver.ts`. ~8m
- [ ] 1.5 Integration proof on postgres:17 (existing docker harness):
  a `bigint({mode:'number'})` array, a `numeric` array, and an
  `interval[]` column round-trip to declared element shapes on a real
  database; files `packages/pg/test/integration.test.ts`. ~8m
- [ ] 1.6 Spec-delta alignment for this group's halves: the
  driver-contract arrival-shape and checkout-hook sentences and the
  query-execution element-wise sentences match what 1.1–1.5 prove —
  every sentence traced; verified by
  `openspec validate harden-query-layer --strict`; files
  `openspec/changes/harden-query-layer/specs/driver-contract/spec.md`,
  `openspec/changes/harden-query-layer/specs/query-execution/spec.md`.
  ~6m

## 2. Write-side value types (#322)

- [ ] 2.1 [design] Write-acceptance unions (owner decision: strict-only
  vs convenience widening — design.md Open Decision 1): the mutation
  value types accept each column's declared read type per the settled
  union; red type test
  `packages/core/test/query/mutate.test.ts` "a default-mode bigint
  column accepts bigint and rejects the settled-out shapes"; files
  `packages/core/src/query/mutate.ts`. ~10m
- [ ] 2.2 [design] Interval write serialization (owner decision:
  canonical literal form — design.md Open Decision 2): a structured
  interval value supplied to a mutation lifts to a bind parameter in
  the settled Postgres interval literal form; red test
  `packages/query/test/compile/mutation.test.ts` "an IntervalValue
  lifts to the canonical interval literal parameter"; files
  `packages/query/src/types/interval.ts` (serialize function),
  `packages/query/src/compile/params.ts`. ~10m
- [ ] 2.3 Numeric mode write path: `bigint` values lift/serialize
  losslessly in every mode's accepted union; array columns accept
  element-typed arrays and lift element-wise; red test
  `packages/query/test/compile/mutation.test.ts` "bigint and
  string-mode numeric values lift losslessly; array values lift
  element-wise"; files `packages/query/src/compile/params.ts`. ~10m
- [ ] 2.4 Round-trip proof: insert through the typed builder →
  select-back yields the written values in declared read shapes
  (unit with recorded driver; the real-database half rides group 1's
  1.5 fixture where files overlap would otherwise occur); red test
  `packages/query/test/db/chain.test.ts` "typed writes round-trip
  through declared read types"; files that test only. ~8m
- [ ] 2.5 Spec-delta alignment: the query-type-inference input-value
  sentences match the settled unions exactly (the reject scenario
  reflects the owner's 2.1 decision); verified by
  `openspec validate harden-query-layer --strict`; files
  `openspec/changes/harden-query-layer/specs/query-type-inference/spec.md`.
  ~6m

## 3. Precision debt (#326, #315, #310)

- [x] 3.1 `Tx.execute` generics (#326): `ExecuteResult<TStatement>`
  threaded through BOTH `Tx` creation sites; the documented-imprecision
  comments and the spec-delta citation of #326 from the previous change
  come out; red type test
  `packages/query/test/db/execute-result-type.test.ts` "tx.execute
  resolves the same types db.execute resolves, at both creation
  sites"; files `packages/query/src/db/transaction.ts`,
  `packages/query/src/db/context.ts`, `packages/query/src/db/db.ts`.
  ~10m
- [x] 3.2 Deferred-branch coverage (#315): the `fn.ts` unresolved-
  scalar guard and the `context.ts` empty-roles message branch each
  get the direct test the execution piece deferred; red tests
  `packages/query/test/db/fn.test.ts` "the scalar-result guard fires
  on a result-less row" and `packages/query/test/db/context.test.ts`
  "an empty declared-role set renders the explicit none-declared
  message"; files those tests only. ~8m
- [x] 3.3 Structurally derived default modes (#310): the default-mode
  constants move to their own module; factories and
  `ts-type-map.ts`'s fallbacks reference them (`typeof`), the C19
  exhaustiveness assertion stays exactly as strong; red test
  `packages/core/test/column-builder.test.ts` "the type-level default
  mode and the runtime default mode are the same constant"; files
  `packages/core/src/types/column-builder-factories.ts`,
  `packages/core/src/types/ts-type-map.ts`, one new constants module
  under `packages/core/src/types/`. ~10m

Verification is the definition of done for every task and for the
change — gates, CRAP non-regression, and `changeset status` (one
`minor` changeset rides whichever group's PR lands first touching a
published package; the fixed group moves all five).
