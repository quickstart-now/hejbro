# Tasks: add-query-layer

Groups are parallel-safe slices (no file overlap). Dependency order:
1 → 2/3 (parallel) → 4 → 5/6 (parallel) → 7. Estimates are pure work
minutes; `openspec/task-times.csv` has no history yet, so these are
first-round estimates. A task is done when its named red test passes
(plus `pnpm check` / `check-types` on the touched package).

## 1. Statement vocabulary (scaffold + core additive gaps)

Reworked after the owner settled the group's [design] decisions
(2026-08-26, during implementation): core's existing QueryNode +
select/insert/update/deleteFrom builders ARE the single statement
vocabulary (D94 as amended); this group closes the two v1 gaps in that
vocabulary instead of building a second IR. The original 1.2/1.4/1.5
[design] decisions are settled: builder call shapes = core's existing
surface; join variant mirrors `innerJoin`; returning selection mirrors
the select object projection (symmetry, not a new contract).

- [x] 1.1 Scaffold `packages/query` (package.json — pure, core-grade
  constraints; tsconfig; vitest config with the #131 source alias); red
  test `packages/query/test/scaffold.test.ts` "resolves @hejbro/core
  from source via the alias". ~6m
- [x] 1.2 Left join: additive `joinKind: "left"` variant + `leftJoin()`
  stage on the core select builder, kind-aware join rendering, codec
  acceptance; red test `packages/core/test/query/select.test.ts`
  "leftJoin records and renders a left join"; files
  `packages/core/src/expr/ast.ts`, `packages/core/src/query/select.ts`,
  `packages/core/src/expr/render-sql.ts`,
  `packages/core/src/expr/codec.ts`. ~10m
- [x] 1.3 Returning column selection: optional object projection on
  `returning()` (symmetric with `select({alias: expr})`) for
  insert/update/delete; red test
  `packages/core/test/query/mutate.test.ts` "returning with a
  projection lists exactly those columns"; files
  `packages/core/src/query/mutate.ts`. ~10m

## 2. Compiler + sql escape hatch

- [x] 2.1 [design] `compile()` result shape and parameter numbering
  rule (ordered params, deterministic output); red test
  `packages/query/test/compile/compile.test.ts` "same statement
  compiles byte-identical twice, no connection"; files
  `src/compile/compile.ts`. ~10m
- [x] 2.2 Select rendering: explicit projection, from, where via
  ExprNode with literal→parameter lifting; red test
  `packages/query/test/compile/select.test.ts` "select with where
  compiles to parameterized SQL, no star"; files
  `src/compile/select.ts`, `src/compile/params.ts`. ~10m
- [x] 2.3 Order/limit rendering; red test
  `packages/query/test/compile/select.test.ts` "order and limit render
  after where"; files `src/compile/select.ts`. ~6m — **subsumed by 2.2**:
  the named test passed on first run, because 2.2's lift walks the whole
  render order (orderBy included) and the contract says `limit` is left
  untouched, so there was no production code left to write. Landed as a
  regression lock instead: the test was strengthened to put literals in
  two different clauses, which is what makes the clause-to-clause
  `startIndex` arithmetic observable at all.
- [x] 2.4 Join rendering with schema-qualified explicit columns; red
  test `packages/query/test/compile/join.test.ts` "left join renders
  left join … on with qualified columns"; files
  `src/compile/select.ts`. ~8m — **subsumed by 2.2** the same way: joins
  are already part of the render-order lift, and core's `renderSelect`
  owns join keywords, schema qualification, and identifier quoting.
  Landed as a regression lock. Its identifier-escaping test builds a
  `SelectNode` directly rather than through `table()`, because D36 bars
  a quote from a declared name — and a hand-built node is a supported
  input (`QueryNode` is in the `compile()` union), so the test exercises
  a real contract, not a contrived path.
- [x] 2.5 Insert/update/delete rendering with explicit `returning`; red
  test `packages/query/test/compile/mutation.test.ts` "insert renders
  parameterized values and explicit returning"; files
  `src/compile/mutation.ts`. ~10m
- [x] 2.6 [design] `sql` tagged template: statement and fragment forms,
  value interpolation → bind parameters, structural composition of
  fragments/identifiers; red test `packages/query/test/sql.test.ts`
  "interpolated value becomes a parameter, never a literal"; files
  `src/sql.ts`. ~10m — `sql` is a thin wrapper delegating every fragment
  semantic to core's own tag (no second `SqlTemplateNode`/`RawSqlNode`
  assembly); the statement form reuses the same `liftExprNode` path as
  every other clause (proved by a mixed-clause numbering test, since
  `params` alone can't show a reset-to-$1 regression). `CompileKind`
  gained a fifth value, `"sql"` — an honest "uncategorized tagged-
  template statement" marker (owner-settled, 2026-08-26), not inferred
  from parsing the text. `compile()` checks the new `statementExpr`
  branch before `unwrapQueryNode`, whose parameter type now structurally
  excludes it — skipping that check is a `tsc` error, not a runtime one.

## 3. Type inference

Reworked after the owner settled the group's [design] decisions
(2026-08-26, before implementation). The trigger: core's `ColumnBuilder`
carries only a coarse `SqlTypeFamily`, so nothing in a declaration
reaches the type level that could answer "is this column `notNull`",
"does it have a default", "is this `json` or `jsonb`", or "how wide is
this integer" — `packages/core/test/column-builder.test.ts:159` even
pins `text().notNull()` as *the same type* as `text()`. Group 3
therefore extends core's column DSL **type** surface additively (one
second, defaulted `TMeta` parameter) and builds the query-side inference
on top of it. Settled decisions:

- Mapping is keyed by the **declared type name**, not the family — a
  family cannot distinguish `json`/`jsonb` (which R3 requires) or
  `bigint`/`integer`.
- `bigint({ mode })` (default `'bigint'`) and `numeric({ mode })`
  (default `'string'`) mirror Drizzle's surface; the mode rides in
  `TMeta` and decides the visible type. Conversion is a pure function
  here and **fails fast** (kebab-code enriched `Error`) rather than
  losing precision silently; wiring it into row mapping is group 4's.
- `interval` surfaces as a structured `IntervalValue`, not `unknown`.
- `jsonb` opts in through `.$type<T>()`, a runtime **identity** method
  (a purely type-level method would not be callable).
- Insert requires a column iff it is `notNull` **without a default**;
  generated columns do not exist in the DSL yet and are a separate
  change. Optional insert fields are `col?: T` under
  `exactOptionalPropertyTypes`.
- Type tests are ordinary `test/types/*.test.ts` files using
  `expectTypeOf` inside a runtime `it()` (repo precedent,
  `packages/core/test/column-builder.test.ts:156-163`); their red/green
  gate is `pnpm check-types`, and every negative case carries either a
  one-difference positive twin or an exact `toEqualTypeOf`.
- Left-join nullability widening is **parked as #307** — it needs
  column-source tracking inside `ColumnRef`, far beyond this change —
  and task 3.14 removes it from this change's delta spec. Generated
  columns do not exist in the DSL at all and are parked as #308.

- [x] 3.1 core `ColumnMeta` + `ColumnBuilder<TFamily, TMeta = ColumnMeta>`
  with the literal declared type name threaded through
  `createColumnBuilder`/`initialColumnBuilder`, the direct-construction
  factories (`varchar`/`char`/`numeric`) and `pgEnum().column()`. The
  four existing type assertions at `column-builder.test.ts:158-161` are
  re-pinned to the narrowed meta here — threading the type name alone
  already breaks them, before `notNull` is type-level at all — so the
  package ends this task type-checking clean; red test
  `packages/core/test/column-builder.test.ts` "factories carry their
  declared type name"; files
  `packages/core/src/types/column-builder.ts`,
  `packages/core/src/types/column-builder-factories.ts`,
  `packages/core/src/dsl/pg-enum.ts`. ~10m
- [ ] 3.2 core modifiers narrow the meta: `notNull()` and `default()`/
  `defaultRandom()`/`defaultNow()` record themselves in `TMeta`, so the
  `text().notNull()` assertion 3.1 re-pinned now separates from plain
  `text()` — the line that used to pin them as *the same type* is the
  proof this group's premise holds, and it is never weakened to an
  assignability check; red test
  `packages/core/test/column-builder.test.ts` "notNull and default are
  visible in the builder type"; files
  `packages/core/src/types/column-builder.ts`. ~8m
- [ ] 3.3 core `TableColumns`/`Table` preserve `TMeta` so a table's
  columns expose their declared meta, with `BuilderFamily` extraction
  unchanged at its four call sites; red test
  `packages/core/test/table-surface.test.ts` "table columns carry their
  declared meta"; files `packages/core/src/dsl/table.ts`. ~10m
- [ ] 3.4 core numeric width modes: `bigint({ mode })` (default
  `'bigint'`, opt-in `'number'`/`'string'`) and `numeric({ mode })`
  (default `'string'`, opt-in `'number'`/`'bigint'`), mode carried in
  `TMeta`, generated SQL unchanged; red test
  `packages/core/test/column-builder.test.ts` "bigint defaults to
  bigint mode and accepts an opt-in mode"; files
  `packages/core/src/types/column-builder.ts`,
  `packages/core/src/types/column-builder-factories.ts`. ~10m
- [ ] 3.5 core `.$type<T>()` jsonb brand — a runtime identity method
  proven harmless: same `columnState`, byte-identical snapshot and SQL
  against an otherwise identical unbranded table, and no brand trace in
  the snapshot JSON; red test
  `packages/core/test/column-builder.test.ts` "$type leaves the
  declaration byte-identical"; files
  `packages/core/src/types/column-builder.ts`. ~10m
- [ ] 3.6 Declared type name (+ mode, + jsonb brand) → TypeScript
  mapping; red type test `packages/query/test/types/column-map.test.ts`
  "each declared type name maps to its TS type"; files
  `packages/query/src/types/column-map.ts`. ~10m
- [ ] 3.7 [design] `IntervalValue` shape — the field set is proposed
  here and confirmed by the owner at PR review, with the Postgres
  months/days/microseconds semantics recorded in tsdoc; red type test
  `packages/query/test/types/interval.test.ts` "an interval column
  surfaces as a structured value"; files
  `packages/query/src/types/interval.ts`. ~8m
- [ ] 3.8 Pure interval parser/normalizer, rejecting unparsable input
  with a kebab-code enriched `Error` rather than a partial value; red
  test `packages/query/test/types/interval.test.ts` "an unparsable
  interval is rejected, never half-parsed"; files
  `packages/query/src/types/interval.ts`. ~10m
- [ ] 3.9 Pure numeric-mode conversions (int8/numeric text → `bigint`/
  `number`/`string`), where `'number'` mode throws a kebab-code enriched
  `Error` beyond `Number.MAX_SAFE_INTEGER` instead of losing precision;
  red test `packages/query/test/types/numeric-mode.test.ts` "number mode
  rejects a value beyond MAX_SAFE_INTEGER"; files
  `packages/query/src/types/numeric-mode.ts`. ~10m
- [ ] 3.10 Select result inference: projection subset decides the row
  keys, `notNull` decides nullability; red type test
  `packages/query/test/types/select-result.test.ts` "projection drives
  the row type"; files `packages/query/src/types/select-result.ts`. ~10m
- [ ] 3.11 Insert input types: required iff `notNull` without a default,
  everything else `col?: T`; red type test
  `packages/query/test/types/insert-input.test.ts` "defaulted column is
  optional on insert"; files
  `packages/query/src/types/insert-input.ts`. ~10m
- [ ] 3.12 Update input types: every declared column optional, unknown
  columns rejected; red type test
  `packages/query/test/types/insert-input.test.ts` "update accepts any
  declared column and rejects unknown ones"; files
  `packages/query/src/types/insert-input.ts`. ~6m
- [ ] 3.13 `returning` rows reuse the select inference rather than
  re-deriving it; red type test
  `packages/query/test/types/returning.test.ts` "returning rows are
  typed like a projection"; files
  `packages/query/src/types/returning.ts`. ~6m
- [ ] 3.14 Delta spec alignment: drop the left-join clause and its
  scenario (parked as #307), scope the insert requirement to "notNull
  without a default" (generated columns parked as #308), and add the
  numeric-mode and structured-interval requirements; verified by
  `openspec validate add-query-layer`; files
  `openspec/changes/add-query-layer/specs/query-type-inference/spec.md`.
  ~8m

## 4. Driver contract + db handle

- [ ] 4.1 [design] Driver contract types + capability keys (kebab-case
  tokens: `interactive-transactions`, `session-state`, …) readable as
  data; red test `packages/query/test/driver/contract.test.ts`
  "capabilities are inspectable before connecting"; files
  `src/driver/contract.ts`. ~10m
- [ ] 4.2 [design] Missing-capability error shape (enriched Error,
  kebab-case code, names capability + operation, thrown before any
  send); red test `packages/query/test/driver/errors.test.ts`
  "transaction on a non-transactional driver fails naming the
  capability"; files `src/driver/errors.ts`. ~8m
- [ ] 4.3 db handle creation (declarations + driver) and execute
  passthrough — driver receives exactly `compile()` output (fake
  driver); red test `packages/query/test/db/execute.test.ts` "executed
  SQL equals previewed compile output"; files `src/db/db.ts`. ~10m
- [ ] 4.4 Callback-scoped transaction API (begin/commit, rollback on
  throw, capability check first); red test
  `packages/query/test/db/transaction.test.ts` "rolls back and
  rethrows when the callback throws"; files `src/db/transaction.ts`.
  ~10m
- [ ] 4.5 `db.as(context)` generic mechanism: role + set_config list
  applied via SET LOCAL inside the wrapping transaction; unscoped
  handle unaffected; red test `packages/query/test/db/context.test.ts`
  "context statements precede the query inside one transaction"; files
  `src/db/context.ts`. ~10m
- [ ] 4.6 Database error propagation with the driver error as `cause`,
  no retry; red test `packages/query/test/db/errors.test.ts`
  "constraint violation rejects with cause"; files `src/db/db.ts`. ~6m
- [ ] 4.7 `db.fn.*` runtime: parameterized invocation, explicit column
  list for returns-table; red test
  `packages/query/test/db/fn.test.ts` "returns-table call renders
  explicit columns, never star"; files `src/db/fn.ts`. ~10m
- [ ] 4.8 `db.fn.*` typing from defineFunction declarations (args +
  return shape; mismatches fail type-check); red type test
  `packages/query/test/db/fn-types.test-d.ts` "wrong argument type is
  rejected statically"; files `src/db/fn-types.ts`. ~10m

## 5. `@hejbro/pg` vanilla driver

- [ ] 5.1 [design] Scaffold `packages/pg` + driver factory signature
  (connection config passthrough to `pg`) and capability declaration;
  red test `packages/pg/test/driver.test.ts` "declares
  interactive-transactions and session-state"; files
  `packages/pg/package.json`, `packages/pg/src/driver.ts`. ~10m
- [ ] 5.2 Execute + transaction implementation over the `pg` client
  (stubbed in unit tests); red test `packages/pg/test/driver.test.ts`
  "runs a parameterized query through one client per transaction";
  files `packages/pg/src/driver.ts`. ~10m
- [ ] 5.3 Docker-gated integration harness against postgres:17 (reuse
  the examples' local-Docker convention); red test
  `packages/pg/test/integration.test.ts` "select round-trips typed
  rows on a real database"; files `packages/pg/test/integration.test.ts`
  harness. ~10m

## 6. Supabase driver + RLS context surface

- [ ] 6.1 [design] `asUser(jwt)` / `asAnon` context builders (role +
  claim set_config mapping per Supabase conventions); red test
  `packages/supabase/test/context.test.ts` "asUser builds authenticated
  role plus JWT claim settings"; files
  `packages/supabase/src/context.ts`. ~10m
- [ ] 6.2 Supabase driver on the shared contract (wraps an existing
  client path, declares its capabilities); red test
  `packages/supabase/test/driver.test.ts` "behaves like the vanilla
  driver for shared capabilities"; files
  `packages/supabase/src/driver.ts`. ~10m
- [ ] 6.3 Real-stack RLS test on the local Supabase stack (colima +
  `supabase start` flow): declared policy filters rows per JWT subject
  through `asUser`; red test
  `packages/supabase/test/rls-context.integration.test.ts` "authUid()
  policy filters by JWT subject"; files that test + harness. ~10m

## 7. Public surface, docs, release wiring

- [ ] 7.1 [design] Public entry surface: `@hejbro/query` barrel exports
  and whether `hejbro` re-exports the query DSL; red test
  `packages/query/test/exports.test.ts` "public surface matches the
  agreed export list"; files `packages/query/src/index.ts` (+ `hejbro`
  re-export file if agreed). ~8m
- [ ] 7.2 AGENTS.md repo-map rows + root README section for the new
  packages; verified by `pnpm check` and the README drift conventions;
  files `AGENTS.md`, `README.md`. ~8m
- [ ] 7.3 [design] Register the new packages with changesets and add
  this change's `minor` changeset — fixed-group membership and first
  version settled with the owner at this task (design.md open
  question); verified by `pnpm changeset status`; files
  `.changeset/config.json`, `.changeset/*.md`. ~6m
