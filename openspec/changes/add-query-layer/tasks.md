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
- Carrying a fact in `ColumnMeta` proves nothing until inference reads
  it, and "ignored field" looks exactly like "all tests green". So
  every `ColumnMeta` field owes a **consumption** test — one that fails
  if the inference drops it — plus composite cases where a whole
  accumulated meta has to survive (`text().notNull().array()`,
  `bigint({mode:'number'}).notNull()`, `jsonb().$type<T>().notNull()`,
  `serial().primaryKey()`).
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
- [x] 3.2 core modifiers narrow the meta: `notNull()` and `default()`/
  `defaultRandom()`/`defaultNow()` record themselves in `TMeta`, so the
  `text().notNull()` assertion 3.1 re-pinned now separates from plain
  `text()` — the line that used to pin them as *the same type* is the
  proof this group's premise holds, and it is never weakened to an
  assignability check; red test
  `packages/core/test/column-builder.test.ts` "notNull and default are
  visible in the builder type"; files
  `packages/core/src/types/column-builder.ts`. ~8m
- [x] 3.3 pin that `Table` preserves `TMeta`: `Table<TColumns>` already
  keeps its own generic parameter, so once 3.1/3.2 narrowed the factory
  return types the meta is recoverable from any `Table` by
  `TTable extends Table<infer TColumns>` — no production change is
  needed and the task's whole value is the regression pin (a later
  edit that collapses `Table` to its refs object would silently break
  every query-side inference). `TableColumns` and the four
  `BuilderFamily` call sites stay untouched; red test
  `packages/core/test/table-surface.test.ts` "table columns carry their
  declared meta"; files that test only. ~10m
- [x] 3.4 core numeric width modes: `bigint({ mode })` (default
  `'bigint'`, opt-in `'number'`/`'string'`) and `numeric({ mode })`
  (default `'string'`, opt-in `'number'`/`'bigint'`), mode carried in
  `TMeta`, generated SQL unchanged. The mode is resolved at the factory
  and stored — `bigint()` is `'bigint'`, never "unset with a default
  applied downstream" — so the type and the runtime conversion can
  never disagree. 3.15's `ArrayCarriedFlags` needs a branch for the new
  flag and 3.15's exhaustive test a `bigint({mode:'number'}).array()`
  case, or `array()` silently drops it — the same bug 3.15 just fixed;
  red test
  `packages/core/test/column-builder.test.ts` "bigint defaults to
  bigint mode and accepts an opt-in mode"; files
  `packages/core/src/types/column-builder.ts`,
  `packages/core/src/types/column-builder-factories.ts`. ~10m
- [x] 3.5 core `.$type<T>()` jsonb brand — a runtime identity method
  proven harmless: same `columnState`, byte-identical snapshot and SQL
  against an otherwise identical unbranded table, and no brand trace in
  the snapshot JSON. Like 3.4, the brand needs its own
  `ArrayCarriedFlags` branch and a `jsonb().$type<T>().array()` case in
  3.15's exhaustive test; red test
  `packages/core/test/column-builder.test.ts` "$type leaves the
  declaration byte-identical"; files
  `packages/core/src/types/column-builder.ts`. ~10m
- [x] 3.6 Declared type name (+ mode, + element) → TypeScript mapping.
  **Re-homed to core mid-flight** (owner, 2026-08-26): `$type` was
  settled as *narrowing only — a brand may not lie* (the brand must be
  a subset of the column's base type), and `$type` is declared in core,
  which cannot import `@hejbro/query`. So the base mapping moves to
  `packages/core/src/types/ts-type-map.ts` — **types only, zero runtime
  symbols** — and the query-side map becomes the thin layer that
  prefers a brand over that base. What the constraint exposed: mapping
  a declared column to a TypeScript type is a property of the
  declaration DSL, not of the query layer; red type test
  `packages/query/test/types/column-map.test.ts` "each declared type
  name maps to its TS type"; files
  `packages/core/src/types/ts-type-map.ts`,
  `packages/core/src/index.ts`,
  `packages/query/src/types/column-map.ts`. ~10m
- [x] 3.7 [design] `IntervalValue` shape — settled by the owner during
  implementation: seven **required** fields (`years`/`months`/`days`/
  `hours`/`minutes`/`seconds`/`microseconds`), never partial, so equal
  intervals compare equal; `microseconds` rather than `milliseconds`
  because Postgres prints six fractional digits and stopping at three
  would drop them silently. No field spans the months/days/microseconds
  axes, which is what keeps the (irreversible) months↔days boundary
  visible. The **type** lives in core's `ts-type-map.ts` with the rest
  of the mapping; the parser stays in `packages/query` (D94: core owns
  the declaration vocabulary and its type surface, query owns runtime
  conversion); red type test
  `packages/query/test/types/interval.test.ts` "an interval column
  surfaces as a structured value"; files
  `packages/core/src/types/ts-type-map.ts`,
  `packages/query/src/types/interval.ts`. ~8m
- [x] 3.8 Pure interval parser/normalizer, rejecting unparsable input
  with a kebab-code enriched `Error` rather than a partial value; red
  test `packages/query/test/types/interval.test.ts` "an unparsable
  interval is rejected, never half-parsed"; files
  `packages/query/src/types/interval.ts`. ~10m
- [x] 3.9 Pure numeric-mode conversions (int8/numeric text → `bigint`/
  `number`/`string`), where `'number'` mode throws a kebab-code enriched
  `Error` beyond `Number.MAX_SAFE_INTEGER` instead of losing precision;
  red test `packages/query/test/types/numeric-mode.test.ts` "number mode
  rejects a value beyond MAX_SAFE_INTEGER"; files
  `packages/query/src/types/numeric-mode.ts`. ~10m
- [x] 3.10 Select result inference: projection subset decides the row
  keys, `notNull` decides nullability. Two branches matching core's own
  `SelectProjection` union: whole-table (`select(table)`) gets full
  per-column richness straight off `Table<infer TColumns>` (task 3.3's
  extraction pattern); the object-projection form
  (`select({a: expr}, table)`) gets exact keys but only a family-based
  type widened to `| null` — `Expr`/`ColumnRef` carry no `TMeta` at all
  (`expr/ast.ts` predates this group, same root cause as #307's parked
  left-join nullability), and matching a projected key's *name* against
  the table's own declared columns to borrow richness was considered and
  rejected (owner/planner): two same-family columns (e.g. `id`/`title`)
  are structurally indistinguishable at that point, so a name match
  would let the type quietly lie about which column an `Expr` actually
  reads from. Not yet wired into `select()`'s actual return type (group
  4, same deferral as task 3.9's runtime conversion); red type test
  `packages/query/test/types/select-result.test.ts` "field consumption
  matrix: each TMeta field the result type actually reads"; files
  `packages/query/src/types/select-result.ts`. ~10m
- [x] 3.11 Insert input types: required iff `notNull` without a default,
  everything else `col?: T` (D8) — a nullable column's value type also
  accepts an explicit `null`, the same direction `select-result.ts`'s
  own read-side widening takes. A pure type utility over
  `Table<infer TColumns>` (task 3.3's extraction pattern), not yet
  wired into `insert()`'s actual parameter type (group 4, same
  deferral as task 3.9/3.10); red type test
  `packages/query/test/types/insert-input.test.ts` "field consumption
  matrix: notNull decides required-vs-optional, hasDefault overrides
  notNull to optional"; files
  `packages/query/src/types/insert-input.ts`. ~10m
- [x] 3.12 Update input types: every declared column optional, unknown
  columns rejected — `notNull`/`hasDefault` don't affect update
  optionality (every key is `col?: T` regardless), but `notNull` still
  forbids an explicit `null` *value* (`InsertColumnValue`, task 3.11,
  reused unchanged). The 3.11/3.12 boundary itself is pinned as a
  contrast pair: the identical `notNull`-without-default declaration is
  a required insert key but an optional update key; red type test
  `packages/query/test/types/insert-input.test.ts` "3.11/3.12 boundary
  contrast pair: the identical declaration (notNull, no default) is
  required on insert but optional on update"; files
  `packages/query/src/types/insert-input.ts`. ~6m
- [x] 3.13 `returning` rows reuse the select inference rather than
  re-deriving it — `ReturningRow<TTable, TProjection>` calls
  `SelectResult` (task 3.10) directly rather than repeating its
  `notNull`-widening/family-mapping logic a second time; core's
  `ReturningProjection` (`query/mutate.ts`) is the identical
  `Record<string, Expr>` shape as `select()`'s own object-projection
  branch, and no-arg `returning()` (every column, spec §5.2) is
  `SelectResult<TTable>`'s whole-table branch. The reuse itself is
  proven by mutation-check, not just by import: breaking
  `SelectResult`'s `notNull` branch breaks
  `returning.test.ts` alongside `select-result.test.ts`, not
  `select-result.test.ts` alone — a structural type-equality assertion
  couldn't tell reuse apart from an independent implementation that
  happens to compute the same answer, only a shared-failure mutation
  can; red type test `packages/query/test/types/returning.test.ts`
  "no-arg returning() is every declared column, typed exactly like the
  whole-table select projection"; files
  `packages/query/src/types/returning.ts`. ~6m
- [x] 3.14 Delta spec alignment: drop the left-join clause and its
  scenario (parked as #307), scope the insert requirement to "notNull
  without a default" (generated columns parked as #308), and add the
  numeric-mode and structured-interval requirements. Carries this
  group's single `minor` changeset too (D59: the group changes
  `@hejbro/core`'s public type surface — mode options, the `$type`
  brand, the widened builder types; the fixed group means naming
  `@hejbro/core` versions all three). Registering the *new* packages in
  `.changeset/config.json` stays task 7.3's; verified by
  `openspec validate add-query-layer` and `pnpm changeset status`; files
  `openspec/changes/add-query-layer/specs/query-type-inference/spec.md`,
  one new `.changeset/*.md`. ~10m
- [x] 3.15 core chain methods preserve the accumulated meta —
  exhaustively, one assertion per method (`notNull`, `primaryKey`,
  `unique`, `default`, `defaultRandom`, `defaultNow`, `array`), each
  applied after `.notNull().default(...)` so dropping the accumulation
  is visible. `array()` additionally records the element's declared
  type name (3.6 maps arrays through it) and must swap `typeName`
  rather than intersect it, since `"text" & "array"` is `never`. Found
  during 3.2: `array()` returned a fixed meta, so
  `text().notNull().array()` typed as nullable while its `columnState`
  said otherwise — a class of bug, not one method's slip; red test
  `packages/core/test/column-builder.test.ts` "every chain method keeps
  the meta it was chained onto"; files
  `packages/core/src/types/column-builder.ts`. ~10m
- [x] 3.16 core type-level `notNull` mirrors `materializeNotNull`
  (`kinds/table-kind.ts:97-105`): `primaryKey()` implies `notNull`, and
  the `serial` family implies both `notNull` and `hasDefault` — its
  `nextval(...)` lives on the synthesized sequence, never on
  `columnState.defaultValue`, so the two rules have to move together or
  `serial().primaryKey()` becomes a *required* insert field. Without
  this, `id: uuid().primaryKey().defaultRandom()` — the dominant
  pattern across `examples/` — infers `string | null` for a column the
  migration emits as `NOT NULL`; red test
  `packages/core/test/column-builder.test.ts` "primary key and serial
  carry their implied not-null"; files
  `packages/core/src/types/column-builder.ts`,
  `packages/core/src/types/column-builder-factories.ts`. ~10m

## 4. Driver contract + db handle

Reworked before summoning (2026-08-26) under the post-g3 discipline:
every [design] decision below is owner-settled IN ADVANCE — ① driver
capabilities are an exhaustive Record (`interactive-transactions`,
`session-state`) under three contract criteria: a mandatory
prerequisite (e.g. bind-parameter execution) is never a capability but
part of the driver type itself; the exhaustive record makes an
undeclared key a compile error, so no implicit default exists; `false`
always fails closed with the explicit error. ② Execution errors wrap
with code `query-execution-failed`, fields `{ kind }`, the
parameterized SQL text in the message (values are all `$n`; `params`
NEVER appear anywhere), driver error as `cause`; conversion failures
are `result-conversion-failed` with `{ column }` and `cause`. ③
`db.fn` is keyed by the declaration record's export names
(`db.fn.helloWorld(args)`). ④ Nested `transaction()` throws
`nested-transaction-unsupported` (savepoints parked as #313);
IntervalStyle is pinned to `'postgres'` by driver session setup
(contract requirement here, implemented by groups 5/6). Estimates are
calibrated on measured pure processing (g2/g3: 0.8–1.1×). Handoff
notes from earlier groups: `const f = (): never => …` does not narrow
control flow after the call — use `function` declarations or `return
throwX(...)`; conversion functions and their per-column runtime meta
(`columnState.mode`/`typeName`) are reachable via the three verified
paths (whole-table meta, projection ColumnRefs by name, db-held
declarations for joined tables).

- [x] 4.0 Scout: wiring inventory — enumerate the three
  meta-access paths against the real g3 code, the compile-output →
  driver surface, and the `(): never` spots to avoid; deliverable = a
  short inventory in the group PR body draft (no code, no test). ~8m
- [x] 4.1 Driver contract types: exhaustive capability Record +
  the three capability criteria in tsdoc + minimal driver interface
  (parameterized execute + transaction primitives + session-setup hook
  for the IntervalStyle pin); red test
  `packages/query/test/driver/contract.test.ts` "a driver missing a
  capability key is a compile error (@ts-expect-error probe)"; files
  `src/driver/contract.ts`. ~10m
- [ ] 4.2 Missing-capability error: code `driver-missing-capability`,
  fields `{ capability, operation }`, thrown before any send; red test
  `packages/query/test/driver/errors.test.ts` "transaction on a
  non-transactional driver fails naming the capability"; files
  `src/driver/errors.ts`. ~6m
- [ ] 4.3 db handle creation (declarations record + driver) and
  execute passthrough — driver receives exactly `compile()` output
  (fake driver); red test `packages/query/test/db/execute.test.ts`
  "executed SQL equals previewed compile output"; files
  `src/db/db.ts`. ~10m
- [ ] 4.4 Result conversion wiring: driver rows normalized per column
  meta (numeric mode, IntervalValue) via the three access paths;
  failure = `result-conversion-failed` `{ column }` + cause; red test
  `packages/query/test/db/convert.test.ts` "bigint text arrives as the
  declared mode's type; a poisoned cell names its column"; files
  `src/db/convert.ts`. ~10m
- [ ] 4.5 Execution error wrapper: `query-execution-failed`,
  `{ kind }`, parameterized SQL text in the message, params never,
  driver error as cause, no retry; red test
  `packages/query/test/db/errors.test.ts` "constraint violation
  rejects with cause and value-free SQL text"; files `src/db/db.ts`.
  ~8m
- [ ] 4.6 Callback-scoped transaction API (begin/commit, rollback on
  throw, capability check first; nested call throws
  `nested-transaction-unsupported` — savepoints parked #313); red test
  `packages/query/test/db/transaction.test.ts` "rolls back and
  rethrows when the callback throws; nested call fails fast"; files
  `src/db/transaction.ts`. ~10m
- [ ] 4.7 `db.as(context)` generic mechanism: role validated against
  declared roles and quoted with core's identifier rule (`SET LOCAL
  ROLE` takes no bind parameters), settings applied via the
  parameterized `select set_config($1, $2, true)` form, all inside the
  wrapping transaction; unscoped handle unaffected; red test
  `packages/query/test/db/context.test.ts` "context applies quoted
  role + parameterized set_config inside one transaction; adversarial
  role/setting strings cannot reach SQL text"; files
  `src/db/context.ts`. ~10m
- [ ] 4.8 Spec deltas for the settled contracts: driver-contract
  (exhaustive record + capability criteria + session IntervalStyle
  requirement), query-execution (error contract incl. SQL-in-message /
  params-never, conversion behavior, nested-transaction error),
  rls-execution-context (quoting + parameterization SHALLs); verified
  by `openspec validate --strict`; files
  `openspec/changes/add-query-layer/specs/{driver-contract,query-execution,rls-execution-context}/spec.md`.
  ~10m
- [ ] 4.9 `db.fn.*` runtime: parameterized invocation, explicit column
  list for returns-table, composes with `db.as`; red test
  `packages/query/test/db/fn.test.ts` "returns-table call renders
  explicit columns, never star"; files `src/db/fn.ts`. ~10m
- [ ] 4.10 `db.fn.*` typing from the declarations record (export-name
  keys; args + return shape; mismatches fail type-check with
  @ts-expect-error probes); red test
  `packages/query/test/db/fn-types.test.ts` "wrong argument type is
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
