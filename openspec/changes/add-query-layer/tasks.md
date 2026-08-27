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

Batch C owner decisions (relayed mid-group, recorded here rather than
left implicit): `db()`'s argument shape settled as **(c′)** — a flat,
heterogeneous schema-module record classified at runtime by
`isTable()`/`declarationKind`, not the earlier `{tables, functions?}`
shape (task 4.3-schema below). Task 4.10 (`db.fn.*` typing) settled as
**(B)** — not the per-function `fn-types.ts` dispatch originally
sketched, and not parked: `FunctionDeclaration` gains a core generic
type surface (task 4.10a, the enabler) which `db.fn.*`'s own call
signature (task 4.10 itself, the consumer — still open below until
this lands) then reads through. Mutation `.returning()` typing settled
as **(a)** — the
same additive-generic treatment applied to `InsertFinal`/`UpdateFinal`/
`DeleteFinal` (task 4.11-mutation below), completing what 4.11 (select)
had explicitly parked pending this decision.

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
- [x] 4.2 Missing-capability error: code `driver-missing-capability`,
  fields `{ capability, operation }`, thrown before any send; red test
  `packages/query/test/driver/errors.test.ts` "transaction on a
  non-transactional driver fails naming the capability"; files
  `src/driver/errors.ts`. ~6m
- [x] 4.3 db handle creation (declarations record + driver) and
  execute passthrough — driver receives exactly `compile()` output
  (fake driver); red test `packages/query/test/db/execute.test.ts`
  "executed SQL equals previewed compile output"; files
  `src/db/db.ts`. ~10m
- [x] 4.3-schema (follow-up, owner decision (c′)): `db()`'s argument
  shape migrated from the originally-scoped `{tables, functions?}`
  record to a flat, heterogeneous schema-module record (e.g.
  `db(schema, driver, {roles?})`), classified once at call time via
  `isTable()`/`declarationKind` rather than pre-sorted by the caller;
  adds an opt-in `options.roles?: ReadonlyArray<Role>` consumed by
  4.7's role whitelist (source ③ of 4). red test
  `packages/query/test/db/db.test.ts` "db(schema, driver, options?) --
  owner decision (c') auto-classification"; files `src/db/db.ts`. ~10m
- [x] 4.4 Result conversion wiring: driver rows normalized per column
  meta (numeric mode, IntervalValue) via the three access paths;
  failure = `result-conversion-failed` `{ column }` + cause; red test
  `packages/query/test/db/convert.test.ts` "bigint text arrives as the
  declared mode's type; a poisoned cell names its column"; files
  `src/db/convert.ts`. ~10m
- [x] 4.4-wiring (follow-up, self-discovered while reviewing 4.11):
  `convert.ts` was self-contained but never called from the actual
  execute pipeline -- `execute()`'s runtime rows stayed raw driver
  text even though 4.11's types promised `bigint`/`IntervalValue`
  ("narrows only, never lies" violation). `execute.ts`'s `executeOn`
  now builds a column plan from the original `CompileInput` (a new
  minimal `queryNodeOf`/`columnPlanForStatement` in `convert.ts`, not
  a copy of `compile.ts`'s private unwrap) and converts rows before
  returning, for both `db().execute` and `tx.execute` (same shared
  pipeline, task 4.5/4.6); an empty plan (the `sql` escape hatch) now
  means "pass the row through unchanged" (`convertRow`'s own
  contract), not "rebuild with zero keys". red test
  `packages/query/test/db/execute-conversion.test.ts` "bigint text and
  interval text arrive converted -- not the driver's raw text"; files
  `src/db/convert.ts`, `src/db/execute.ts`, `src/db/transaction.ts`,
  `src/db/db.ts`. ~15m
- [x] 4.5 Execution error wrapper: `query-execution-failed`,
  `{ kind }`, parameterized SQL text in the message, params never,
  driver error as cause, no retry; red test
  `packages/query/test/db/errors.test.ts` "constraint violation
  rejects with cause and value-free SQL text"; files `src/db/db.ts`.
  ~8m
- [x] 4.6 Callback-scoped transaction API (begin/commit, rollback on
  throw, capability check first; nested call throws
  `nested-transaction-unsupported` — savepoints parked #313); red test
  `packages/query/test/db/transaction.test.ts` "rolls back and
  rethrows when the callback throws; nested call fails fast"; files
  `src/db/transaction.ts`. ~10m
- [x] 4.7 `db.as(context)` generic mechanism: role validated against
  the 4-source declared-role union (`GrantDeclaration.role`,
  `PolicyDeclaration.roles` walked per table, `db()`'s opt-in
  `options.roles`, `driver.contributedRoles`) and quoted with core's
  identifier rule only (`SET LOCAL ROLE` takes no bind parameters, and
  never special-cases bare `public` — that exception is a `GRANT`/
  `REVOKE` keyword rule, not a `SET LOCAL ROLE` one), settings applied
  via the parameterized `select set_config($1, $2, true)` form, all
  inside the wrapping transaction; unscoped handle unaffected; red
  test `packages/query/test/db/context.test.ts` "context applies
  quoted role + parameterized set_config inside one transaction;
  adversarial role/setting strings cannot reach SQL text"; files
  `src/db/context.ts`. ~10m
- [x] 4.9-fallback (follow-up, owner review of task 4.10's own "known,
  documented imprecision") `dispatchCall`'s unresolved-target-table
  branch (task 4.9) silently fell back to a bare, untyped scalar call
  instead of failing — the same "type lies" shape 4.4-wiring and the
  missing-`"result"`-key guard (task 4.10) both already existed to rule
  out, and an implicit guess this project consistently rejects
  elsewhere (never `select *`, capability checks fail closed, an
  undeclared role has no escape hatch). Now throws
  `function-target-table-undeclared`, naming the missing table, before
  any statement is sent; the now-unreachable "scalar call with no
  declared type" path is removed with it. red test
  `packages/query/test/db/fn.test.ts` "fails fast, never a silent
  scalar guess, when the returns-table's target table isn't declared
  in this handle's own schema module"; files `src/db/fn.ts`. ~10m
- [x] 4.8 Spec deltas for the settled contracts: driver-contract
  (exhaustive record + capability criteria + session-setup-hook
  requirement, `IntervalStyle` pinning scoped to the driver's own
  responsibility), query-execution (nested-transaction error, SQL-in-
  message/params-never error contract, result-conversion/fail-fast
  behavior), rls-execution-context (the role 4-source-union whitelist,
  quoting + parameterization SHALLs); every added sentence traces to an
  existing test (one new probe added first, `setupSession` mandatory on
  `Driver`, mirroring the existing `execute`-mandatory one — needed
  before the session-setup-hook sentence could name a test); no
  narrowing or loosening of the pre-existing group 5/6-owned
  requirements (vanilla/preset driver, `asUser`/`asAnon` context
  surface) in the same files; verified by `openspec validate --strict`;
  files
  `openspec/changes/add-query-layer/specs/{driver-contract,query-execution,rls-execution-context}/spec.md`,
  `packages/query/test/driver/contract.test.ts`.
  ~10m
- [x] 4.9 `db.fn.*` runtime: parameterized invocation, explicit column
  list for returns-table, composes with `db.as`; red test
  `packages/query/test/db/fn.test.ts` "returns-table call renders
  explicit columns, never star"; files `src/db/fn.ts`. ~10m
- [x] 4.10a (owner decision (B), enabler half of 4.10 — not the whole
  task) core generic type surface for `defineFunction`:
  `FunctionDeclaration` gains a defaulted `TArgs`/`TReturns` type
  parameter pair carrying the declared args shape and return target,
  via a non-enumerable phantom anchor field (mirrors
  `column-builder.ts`'s `columnMetaBrand`); additive only — every
  existing non-generic consumer (`function-kind.ts`,
  `define-trigger.ts`, `render-body.ts`) compiles unchanged; red test
  `packages/core/test/define-function.test.ts`
  "FunctionDeclaration<TArgs, TReturns> generics (task 4.10)"; files
  `packages/core/src/dsl/define-function.ts`. ~10m
- [x] 4.10 `db.fn.*` typing from the declarations record (the
  consumer half 4.10a enables): named-object call signature derived
  from `TArgs` (owner decision, args-as-object) via g3's `ts-type-map`
  (`ColumnTsType`); `TypedFnApi` keyed exactly to the declarations
  record's function export names (a nonexistent key is a compile
  error, owner decision ③'s static pinning) — required threading a
  defaulted `TFunctions` type parameter through `Db`/`ScopedDb`/`db()`
  itself (`fn-types.ts`'s own `FunctionsOf<TSchema>`), a larger surface
  than this task's own `files:` line implied, confirmed in-scope
  (`src/db/**`) before starting; return row type derived from
  `TReturns` (a `Table` target resolves through `SelectResult<TTable>`,
  a scalar `TypeNode` maps through core's public `BaseTsType` with a
  local array-shape adapter). **4.9's own scalar contract turned out to
  be spec-non-compliant** (`typed-function-execution` says a scalar
  call "resolves to a value", `db.fn`'s runtime returned an unaliased
  row array for both shapes) — fixed in the same task: scalar calls now
  render an explicit `as "result"` alias and resolve to the bare
  converted value, with a new `function-scalar-result-missing` fail-fast
  guard and the first scalar-return `defineFunction` fixture/coverage
  this codebase has had. Runtime still renders positional SQL in
  declared argument order; the named→positional lookup reads each
  argument by `declaration.args[].argName` (matched via `toSnakeCase`,
  since `FunctionDeclaration.args` never preserves the original
  camelCase key), never `Object.values(args)` (object key order is
  call-site insertion order, not declaration order). red tests
  `packages/query/test/db/fn-types.test.ts` — five `@ts-expect-error`
  probes (typo key, missing key, wrong type, excess key on a fresh
  object literal, nonexistent function key) — and
  `packages/query/test/db/fn.test.ts`'s reversed-call-order fixture
  asserting `params` (not the SQL text, which is `$1, $2` either way)
  lands in declared order; files `packages/query/src/db/fn-types.ts`,
  `src/db/fn.ts`, `src/db/db.ts`, `src/db/context.ts`. Initially left
  `dispatchCall`'s own pre-existing unresolved-table fallback (task
  4.9) as a documented imprecision (a `returns`-table function
  resolving to a bare scalar value at runtime, while the type still
  promised `ReadonlyArray<SelectResult<TTable>>`) — owner review
  rejected leaving it documented (the same "type lies" shape already
  fixed twice this task), so it was closed for real in task
  4.9-fallback below instead of staying a caveat. ~35m
- [x] 4.11-mutation (owner decision (a), completing what 4.11 below
  parked) core generic type surface for the mutation builders:
  `InsertFinal`/`UpdateFinal`/`DeleteFinal` (and their
  `*Returnable`/`*Filterable` intermediates) gain defaulted
  `TTable`/`TReturning` type parameters tracking the target table and
  `.returning(...)` projection through the whole `insert`/`update`/
  `deleteFrom` chain, via a shared non-enumerable phantom anchor; `Db`'s
  `ExecuteResult` (task 4.11 below) gains the corresponding
  `InsertFinal`/`UpdateFinal`/`DeleteFinal` conditional branches,
  resolved through g3's existing `ReturningRow<TTable, TProjection>`
  (reused, not recreated) — core stays free of `@hejbro/query`; red
  tests `packages/core/test/query/mutate.test.ts`
  "InsertFinal/UpdateFinal/DeleteFinal<TTable, TReturning> generics
  (task 4.11-mutation)" and
  `packages/query/test/db/execute-result-type.test.ts` "Db.execute's
  resolved row type for mutations (task 4.11-mutation)"; files
  `packages/core/src/query/mutate.ts`, `packages/query/src/db/db.ts`.
  ~15m
- [x] 4.11 (new, batch A review, #293 group 4) `execute()`'s resolved
  row type for `select()` (query-execution's ADDED requirement "rows
  typed by the statement's inferred result type" had no owning task —
  reviewer's requirement-reversal found the gap): `Db["execute"]`
  dispatches structurally on `SelectLimited<TProjection>` to
  `SelectResult<TProjection>` (task 3.10) at the time this task landed;
  mutation `returning()` typing was out of scope pending the owner's
  `InsertFinal`/`UpdateFinal`/`DeleteFinal` genericity decision (same
  erasure class as 4.10) and has since been completed by
  4.11-mutation above, which added the corresponding conditional
  branches to this same `ExecuteResult` type; everything else (bare
  `QueryNode`, `sql`) keeps the plain `DriverRow` shape. red test
  `packages/query/test/db/execute-result-type.test.ts` "a whole-table
  select resolves the declared column types exactly"; files
  `src/db/db.ts`. ~10m

## 5. `@hejbro/pg` vanilla driver

Reworked before summoning (2026-08-27) under the post-g3 discipline:
every [design] decision below is owner-settled IN ADVANCE. ① Factory =
instance-based `pgDriver(pool)` with **nominal `pg` typing** (`pg` as a
peerDependency, `@types/pg` supplying types; Drizzle-parallel surface).
② A connection-string convenience overload `pgDriver(connectionString)`
constructs and owns a `Pool`, exposes it as `driver.client`, and never
auto-closes it (Drizzle convention: pool lifetime = process lifetime;
callers that need teardown call `driver.client.end()`). ③ Row
representation contract: rows arrive as node-postgres **default** shapes
except `interval` (oid 1186), which must reach the conversion layer as
raw Postgres text via a **per-query `types` override** that delegates
every other oid to pg's defaults — the mechanism Drizzle's own
node-postgres session uses; a global `pg.types.setTypeParser` mutation
is rejected (silently rewrites the user's other queries). The
arrival-shape table becomes normative driver-contract sentences (task
5.7). ④ IntervalStyle pin: `setupSession` runs
`set intervalstyle to 'postgres'` once per new physical connection,
enforced at checkout with a WeakSet guard — pool `connect` listeners
are not awaited, so a listener-only pin races the first caller
statement. ⑤ Integration harness: Docker-gated `test:integration`
script outside the default `pnpm test` (roundtrip.sh convention: loud
failure with guidance when Docker is absent; local-only, never CI).
Capabilities: `interactive-transactions` and `session-state` are both
`true` (TCP session semantics). Prerequisite already landed with this
rework: `@hejbro/query`'s provisional entry surface (source-pointing
`exports` + barrel) so this package can depend on it; task 7.1 replaces
that surface. The moded-array conversion gap
(`bigint({mode}).array()`) is scouted in 5.0 and filed as an issue if
real — never fixed here (`packages/query/src` is outside this group's
file scope). `pnpm-lock.yaml` will conflict with group 6; the lead
resolves it at rebase by regenerating.

- [ ] 5.0 Scout: pin the installed `pg`'s actual behaviors the settled
  design assumes — default parsers (int8/numeric → text, interval →
  object, timestamptz → Date), the per-query `types` config path, pool
  connect/checkout mechanics — and verify the moded-array gap (file an
  issue if confirmed, no fix); deliverable = a short inventory in the
  group PR body draft (no code, no test). ~6m
- [ ] 5.1 Scaffold `packages/pg` (private like `packages/query`,
  source-pointing exports, vitest aliases for `@hejbro/core` AND
  `@hejbro/query` per #131, turbo.json; `pg` peerDependency plus
  `pg`/`@types/pg` devDependencies) + `pgDriver(pool)` returning the
  capability declaration; red test `packages/pg/test/driver.test.ts`
  "declares interactive-transactions and session-state true"; files
  `packages/pg/package.json`, `packages/pg/tsconfig.json`,
  `packages/pg/vitest.config.ts`, `packages/pg/turbo.json`,
  `packages/pg/src/driver.ts`. ~10m
- [ ] 5.2 Connection-string overload: `pgDriver(connectionString)`
  constructs and owns a `Pool`, exposed as `driver.client` (the
  instance form sets `client` to the caller's own pool — one surface,
  no divergence), never auto-closed; red test
  `packages/pg/test/driver.test.ts` "a connection-string driver exposes
  its own pool as client"; files `packages/pg/src/driver.ts`. ~6m
- [ ] 5.3 Execute + per-query interval override: `execute` sends
  `{ text, values, types }` where the `types` override returns raw text
  for oid 1186 and delegates every other oid to pg's defaults; red test
  `packages/pg/test/driver.test.ts` "interval reaches the row as
  Postgres text while other types keep pg defaults" (stub pool
  asserting the query config); files `packages/pg/src/driver.ts`. ~10m
- [ ] 5.4 Transaction: one client checkout per `transaction()`,
  begin/commit, rollback + rethrow when the callback throws, the
  session bound to that one client (stubbed pool); red test
  `packages/pg/test/driver.test.ts` "runs a transaction's statements
  through one held client and rolls back on throw"; files
  `packages/pg/src/driver.ts`. ~10m
- [ ] 5.5 setupSession IntervalStyle pin at checkout: WeakSet-guarded
  `set intervalstyle to 'postgres'` before the first caller statement
  on every new physical connection, on both the `execute` and
  `transaction` paths; red test `packages/pg/test/driver.test.ts` "a
  fresh connection is pinned before the first caller statement, once
  per connection"; files `packages/pg/src/driver.ts`. ~8m
- [ ] 5.6 Docker-gated integration harness (postgres:17): a
  `test:integration` script outside the default `test`, failing loudly
  with guidance when Docker is absent; proves the declared arrival
  shapes end-to-end — bigint/numeric modes, `IntervalValue` (pin +
  override together), `Date` columns — through a real `db()` handle;
  red test `packages/pg/test/integration.test.ts` "select round-trips
  typed rows on a real database"; files
  `packages/pg/test/integration.test.ts`, `packages/pg/package.json`.
  ~10m
- [ ] 5.7 Spec-delta alignment (this group owns
  `specs/driver-contract/spec.md`): the row arrival-shape requirement,
  the vanilla driver's capability values, and the session-setup pin
  wording — every added sentence tracing to a 5.x test; verified by
  `openspec validate add-query-layer --strict`; files
  `openspec/changes/add-query-layer/specs/driver-contract/spec.md`.
  ~8m

## 6. Supabase driver + RLS context surface

Reworked before summoning (2026-08-27) under the post-g3 discipline:
every [design] decision below is owner-settled IN ADVANCE. ①
Composition = **decorator**: `supabaseDriver(driver)` accepts any
contract `Driver` and adds Supabase's contribution; it never imports
`@hejbro/pg` (parallel-safety with group 5 by construction — the
composed end-user UX is `supabaseDriver(pgDriver(pool))`). ② Context
surface = claims object only: `asUser(claims)` (requires `sub`) fixes
role `authenticated` and sets exactly one setting —
`request.jwt.claims` = the claims JSON merged with
`role: "authenticated"`; `asAnon()` fixes role `anon` with claims
`{"role":"anon"}`. Verification is NEVER owned here: it stays with the
app's auth layer (supabase-js `getClaims`, Clerk `sessionClaims`,
Auth0 sessions, or jose against a custom JWKS), and those recipes are
documented first-class. Raw-token surfaces were rejected with the owner
(unverified → forged-`sub` RLS bypass; self-verified → reimplementing
the platform's JWKS verifier inside the preset); the automation
follow-up (claims-provider callback) is parked as #318 and the
transaction-mode-pooler capability story as #317. ③ `contributedRoles`
= exactly `anon`/`authenticated`/`service_role` (the existing
`roles.ts` constants) — the fourth source of task 4.7's declared-role
union, so a grant-less schema still unlocks `asUser`/`asAnon`. ④ This
group carries the change's `minor` changeset: it touches published
`@hejbro/supabase` (group 5 touches only private packages, so the D59
gate asks nothing of it). File scope: `packages/supabase/**`, the
rls-execution-context delta spec, and `.claude/rules/supabase-preset.md`;
`pnpm-lock.yaml` conflicts are the lead's to resolve at rebase.

- [x] 6.0 Scout: pin the local-stack facts the settled design assumes —
  the `supabase start` DB connection string/port, the three roles
  exist, `auth.uid()` reads `request.jwt.claims`, and
  `set local role authenticated` enforces RLS on postgres-owned
  tables; deliverable = a short inventory in the group PR body draft
  (no code, no test). ~6m — run against a scratch `supabase init`
  project outside the repo (this worktree carries no `config.toml`).
  Confirmed DB URL matches the assumed default:
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. All three
  roles (`anon`/`authenticated`/`service_role`) exist in `pg_roles`.
  `\sf auth.uid` shows it reads `request.jwt.claims` (a legacy flat
  `request.jwt.claim.sub` is checked first via `nullif`/`coalesce` but
  falls through when unset) — settled design ② needs only the one JSON
  setting, no flat key. `set local role authenticated` + `set_config`
  on `request.jwt.claims` inside a transaction against a postgres-owned
  table with an `owner = auth.uid()` policy showed exactly the matching
  row, proving RLS is enforced under the role switch (owner/superuser
  bypass does not leak through `set local role`). One design
  consequence found: plain `supabase start` fails under colima — the
  `vector` log-collector container tries to mount
  `~/.colima/default/docker.sock` and colima's virtiofs rejects it
  (`mkdir ... operation not supported`); `-x vector` (plus other
  unneeded services) works around it locally. Rather than baking a
  colima-specific exclude flag into a committed script, 6.4 goes with
  detect-and-guide instead of start-the-stack (lead decision): it reads
  `SUPABASE_DB_URL` (default the URL above), fails loudly instead of
  starting anything, and its guidance message names `supabase start`
  plus the colima `-x vector` workaround.
- [x] 6.1 `asUser(claims)`/`asAnon()` context builders per the settled
  shape (single `request.jwt.claims` JSON setting, fixed roles); red
  test `packages/supabase/test/context.test.ts` "asUser builds the
  authenticated role plus one JSON claims setting; asAnon builds anon";
  files `packages/supabase/src/context.ts`,
  `packages/supabase/src/index.ts`. ~8m — `sub` is required both at the
  type level (`Claims["sub"]: string`, non-optional) and again at
  runtime (`claims-subject-missing` kebab-code enriched `Error`, a
  `function` declaration per the g2/g3 `(): never` handoff note) as a
  fail-fast guard for a caller that bypasses the type; a caller-supplied
  `role` claim is always discarded and overwritten with
  `"authenticated"`, never trusted (lead-confirmed). Two extra tests
  beyond the named red one lock in coverage-completing branches: the
  role-overwrite behavior and the missing-`sub` throw.
- [x] 6.2 `supabaseDriver(driver)` decorator: adds `contributedRoles` =
  anon/authenticated/service_role and passes every other member through
  unchanged (capabilities, execute, transaction, setupSession); adds
  the `@hejbro/query` dependency and its #131 vitest alias to this
  package; red tests `packages/supabase/test/driver.test.ts`
  "contributes exactly the three Supabase roles" and "passes every
  wrapped driver member through unchanged"; files
  `packages/supabase/src/driver.ts`, `packages/supabase/src/index.ts`,
  `packages/supabase/package.json`,
  `packages/supabase/vitest.config.ts`. ~8m — a one-expression object
  spread (`{ ...driver, contributedRoles: [...] }`), so the passthrough
  proof is structural rather than a spot-check: it asserts every own
  key of the wrapped-*input* driver is `===` identical on the *output*,
  which a future `Driver` contract addition would carry automatically
  and a hand-listed member enumeration would silently miss — scoped to
  **own enumerable** properties (object spread's own boundary; a
  prototype-chain or non-enumerable member would not be copied, and
  neither the decorator nor this test would catch that, reviewer note
  on batch A review).
  `@hejbro/query` is added as a **runtime** `dependencies` entry, not
  `devDependencies` (its `Driver` type reaches this package's own
  public d.ts) — `.claude/rules/supabase-preset.md` still describes the
  pre-D95 core-only boundary; its update is task 6.5's.
- [x] 6.3 Task 4.7 (a′) union wiring proof: with a schema declaring
  ZERO grants/policies, `db(schema, supabaseDriver(fake))` accepts
  `.as(asAnon())` and `.as(asUser(...))` (roles arrive via the driver
  contribution) while an undeclared role is still rejected; red test
  `packages/supabase/test/driver.test.ts` "driver-contributed roles
  unlock asUser/asAnon on a grant-less schema; undeclared roles stay
  rejected"; files that test only. ~6m — passed on first run (pure
  wiring proof over 6.1/6.2's already-landed code, no production
  change), so the named test is a regression lock rather than a
  red-to-green cycle: a plain table with no `rls`/`grant` and
  `db(schema, supabaseDriver(fakeDriver()))` accepts both
  `.as(asAnon())` and `.as(asUser({sub:...}))` without throwing, while
  `.as({role: roleName("nonexistent_role")})` still throws
  `undeclared-role`.
- [x] 6.4 Real-stack RLS integration (colima + `supabase start`): a
  `test:integration` script outside the default `test`, failing loudly
  with guidance when the stack is down; a declared `authUid()` policy
  filters rows per `asUser` claims' `sub`, and `asAnon` sees none; red
  test `packages/supabase/test/rls-context.integration.test.ts`
  "authUid() policy filters by claims subject through asUser"; files
  that test + `packages/supabase/package.json`. ~10m — detect-and-guide
  (never starts the stack), `SUPABASE_DB_URL` defaulting to 6.0's own
  measured URL; a fail-loud test run against a deliberately unreachable
  URL confirmed a single clean guidance-message failure, not a silent
  skip. Adds `vitest.integration.config.ts` (`mergeConfig`-inherits the
  base config's #131 aliases, `include`/`exclude` explicitly replaced
  as a plain spread *after* `mergeConfig` — a real bug caught while
  building this: `mergeConfig` concatenates array fields rather than
  replacing them, so passing `exclude: []` through it left the base
  config's own integration-exclusion pattern in the merged result and
  the "integration" run silently executed the full default unit suite
  instead, 0 integration tests actually collected, green-looking).
  Bidirectionally verified: default `pnpm test` collects exactly the
  pre-6.4 count (15 files/107 tests, unchanged), `--config
  vitest.integration.config.ts` collects and passes exactly the 3 tests
  in the new file (alias self-check + the two RLS scenarios) against a
  live scratch stack. `packages/supabase/vitest.config.ts` also gains
  the two-pattern exclude (`test/**/*integration.test.ts` +
  `test/integration/**`) and `pg`/`@types/pg` land as devDependencies
  (not `@hejbro/pg`, which doesn't exist on this branch — group 5's own
  scope); per the lead's hard rule, no `src/` code was added — the
  connection guard, DDL fixture, and hand-rolled `Driver` all live
  inside the test file, so 6.1/6.2's unit tests keep sole ownership of
  every `src/` branch the CRAP gate scores (confirmed unchanged: 1108
  functions scanned, 0 over budget, highest still 5.00).
- [x] 6.5 Spec-delta alignment (this group owns
  `specs/rls-execution-context/spec.md`: the claims-object surface, the
  single-JSON-setting mapping, and the verification-stays-with-the-app
  sentence, each tracing to a 6.x test) + `.claude/rules/
  supabase-preset.md` gains the driver as a preset contribution (D95) +
  this group's `minor` changeset; verified by
  `openspec validate add-query-layer --strict` and
  `pnpm changeset status`; files
  `openspec/changes/add-query-layer/specs/rls-execution-context/spec.md`,
  `.claude/rules/supabase-preset.md`, one new `.changeset/*.md`. ~8m —
  spec delta (claims-object surface, single-JSON-setting mapping,
  verification-stays-with-the-app requirements added; the pre-existing
  "Presets define the context type" requirement's `asUser(jwt)` wording
  corrected to `asUser(claims)`), `.claude/rules/supabase-preset.md`
  (line 8 sentence + line 9 count, four → five things, the driver
  contribution), and the changeset file are all written and
  `openspec validate add-query-layer --strict` passes.
  `pnpm changeset status` initially failed (`"@hejbro/supabase" depends
  on the skipped package "@hejbro/query"` — `@hejbro/query` is
  `private: true`, never published, but has sat in `@hejbro/supabase`'s
  runtime `dependencies` since task 6.2, `47aac29`; this predates 6.5,
  batch A's own gate list just never ran `changeset status`, a planning
  gap not an implementation one), escalated to the planner/lead, and
  resolved by a **lead-prescribed, one-key addition** to
  `.changeset/config.json` — `"privatePackages": { "version": true,
  "tag": false }` (changesets v3.0.1) — nothing else in that file
  touched. **7.3 pre-work, lead-prescribed**: this settles gate honesty
  only — fixed-group membership and first-version policy remain task
  7.3's own owner decision. Side effect, recorded rather than hidden:
  `updateInternalDependencies` now also patch-bumps every other private
  workspace package (`cli-smoke`, `example-postgres`,
  `example-supabase`, `preset-smoke`) alongside `@hejbro/query` in
  `changeset status`'s output — none of them publish (`tag: false` +
  `private: true`), so this is Version PR churn, not a release change;
  the already-held #289 Version PR and 7.3's own final config shape
  make it an acceptable interim state. `pnpm changeset status
  --since=upstream/dev` now exits 0.

## 7. Public surface, docs, release wiring

Reworked before summoning (2026-08-27) with every [design] decision
owner-settled IN ADVANCE, plus — the g5 lesson — the gate wiring and
test-binding standards pre-settled in this header rather than arriving
as rework. Settled decisions: ① **hejbro facade (A)**: the `hejbro`
package re-exports the query layer's user surface — `db`, the chain
entry points, and `@hejbro/query`'s dual-use `sql` (which REPLACES the
current core-`sql` re-export; it delegates to the same core tag, so
existing fragment uses are unaffected — "one `sql` in the hejbro
barrel") — drivers stay in their own packages. ② **db-first chain
included in this group**: `handle.select(...)`, `handle.insert(...)`,
`handle.update(...)`, `handle.deleteFrom(...)` mirror core's builder
stages and are the promoted default UX; `db.execute` remains the
documented low-level primitive. ③ **Chain termination = thenable**
(Drizzle-form): a chain is completely inert until awaited (build only,
no I/O); `.compile()` on every chain returns the pure `CompileResult`
(byte-identical to `compile(statement)`, no driver call) — the AX
preview stays first-class; the chain surface is IDENTICAL on the three
execution surfaces (unscoped handle, `db.as` scoped handle, `tx`) via
one shared factory; chains delegate to core's builders — no second
statement vocabulary (D94). ④ **Release wiring**: `@hejbro/query` and
`@hejbro/pg` get real packaging (tsdown build, dist-pointing exports,
`files: [dist]`, LICENSE, README, `prepack`) and flip `private: false`;
BOTH join the changeset **fixed group (five packages total)** — the
next release aligns everything at 0.2.0 (npm reality measured
2026-08-27: no 0.2.0 was ever published or burned for any package;
`@hejbro/query`/`@hejbro/pg` are E404 on the registry); the interim
`privatePackages` config entry is REMOVED (the invalid tree it worked
around disappears when query publishes); the pack-install smoke
promotes query/pg into `PACKAGES` (full 1a–1c assertions) and drops
the interim file-wiring block; landing this group lifts the #289
release hold (comment on #289 — lead does it at close).

Gate wiring & binding standards (pre-settled, violations are rework):
per-package `turbo.json` `check-types: {dependsOn: ["^build"]}` is
already present in query/pg/supabase/cli (verified 2026-08-27) — the
dist flip therefore type-checks against fresh builds; the #131 vitest
aliases in pg/supabase keep tests on source after the flip (verify,
don't assume); every chain stage owes a **delegation mutation** (break
the delegation to core's builder → the stage's test goes red — the
C1 lesson: pin every axis, not one); thenable inertness owes a
negative probe (no driver call before await); the test-only conversion
exports (`resolveColumnState`/`columnPlanForResult`/`convertRow`/
`ColumnPlanEntry`) owe an absence probe in the barrel test; every
spec-delta sentence traces to a named test; all gate runs use
`TURBO_CACHE_DIR="$PWD/.turbo/cache-<tag>"` + `--force` and cite
`Cached: 0`; review targets are single SHAs ("this SHA is the sole
judgment target"); mutation verdicts pass the 3-step validity protocol
before any "survived" call. This group carries one `minor` changeset
(the facade changes published `hejbro`). File scope: `packages/query/**`,
`packages/pg/**` (packaging files only), `packages/cli/**` (facade +
packaging wiring), `.changeset/config.json`, `scripts/pack-install-smoke.sh`,
`AGENTS.md`, `README.md` (repo-map/section — the CRAP block itself
stays lead-owned), and the query-builder/query-execution spec deltas.

- [x] 7.0 Scout: chain wiring inventory — core builder stage types
  (select stages, mutation stages, returning), where `executeOn`
  accepts statements, how `ExecuteResult`/`SelectResult` resolve, the
  `sql` replacement compatibility in the hejbro barrel (dual-use tag is
  a structural superset — verify against the cli re-export list); no
  code; deliverable = inventory in the group PR body draft. ~8m
- [x] 7.1 Thenable select chain on the unscoped handle:
  `handle.select(table | projection, table)` mirrors core's two
  `select` forms; every stage (`where`/`orderBy`/`limit`/`innerJoin`/
  `leftJoin`) delegates to the corresponding core builder stage; the
  chain is inert until awaited, then runs the shared execute pipeline
  (row conversion included); red test
  `packages/query/test/db/chain.test.ts` "await on a select chain
  returns converted rows; before await no driver call is made"; files
  `packages/query/src/db/chain.ts`, `packages/query/src/db/db.ts`. ~10m
- [x] 7.2 Thenable mutation chains: `insert().values().returning()`,
  `update().set().where().returning()`, `deleteFrom().where()
  .returning()` — same delegation + inertness rules; a returning-less
  mutation resolves exactly like `db.execute` of that statement; red
  test `packages/query/test/db/chain.test.ts` "mutation chains execute
  with and without returning, inert until awaited"; files
  `packages/query/src/db/chain.ts`. ~10m
- [x] 7.3 `.compile()` on every chain: pure preview, byte-identical to
  `compile()` of the equivalent statement, zero driver interaction; red
  test `packages/query/test/db/chain.test.ts` "chain.compile() equals
  compile(statement) and never touches the driver"; files
  `packages/query/src/db/chain.ts`. ~6m
- [x] 7.4 Chain surface uniformity: the same chain members on
  `db.as(context)`'s scoped handle and on `tx` inside
  `transaction()` — one shared chain factory parameterized by the
  send primitive (the `executeOn`/`scopedRun` pattern), so context
  application can never cover one surface and miss another; red test
  `packages/query/test/db/chain.test.ts` "scoped and tx chains run
  under their context/session (recorded SQL proves it)"; files
  `packages/query/src/db/chain.ts`, `src/db/context.ts`,
  `src/db/transaction.ts`. ~10m
- [x] 7.5 Chain result types: awaiting a chain resolves the same types
  `db.execute` resolves (`SelectResult`/`ReturningRow` reuse — proven
  by shared-failure mutation, not import alone); red type test
  `packages/query/test/types/chain-types.test.ts` "chain await types
  equal execute types for select and returning mutations"; files
  `packages/query/src/db/chain.ts`. ~10m
- [x] 7.6 `@hejbro/query` real packaging: tsdown config + `build`
  script + `prepack`, exports flipped to dist (`types`/`import` →
  `./dist/*`), `files: ["dist"]`, LICENSE, package README,
  `private` flipped to false, version left at 0.0.0 (changesets aligns
  at release); per-package turbo build outputs wired; red proof: the
  pack-install smoke (task 7.10) fails before this lands and passes
  after — locally a `pnpm build` + `pnpm pack` tarball listing
  asserts dist entries; files `packages/query/package.json`,
  `packages/query/tsdown.config.ts`, `packages/query/turbo.json`,
  `packages/query/LICENSE`, `packages/query/README.md`. ~10m
- [x] 7.7 `@hejbro/pg` real packaging: same treatment; files
  `packages/pg/package.json`, `packages/pg/tsdown.config.ts`,
  `packages/pg/turbo.json`, `packages/pg/LICENSE`,
  `packages/pg/README.md`. ~8m
- [x] 7.8 `@hejbro/query` final public barrel (settles the provisional
  surface): the agreed export list — `db`, chain types, `compile`,
  `sql`, driver-contract types, `DbContext`/`ScopedDb`/`Tx`, result
  types — plus the absence probe for the four test-only conversion
  exports; red test `packages/query/test/exports.test.ts` "public
  surface matches the agreed list; test-only helpers are absent";
  files `packages/query/src/index.ts`. ~8m
- [x] 7.9 hejbro facade: re-export `db` + query's dual-use `sql`
  (replacing the core `sql` re-export — one `sql`) + the key query
  types from `@hejbro/query`; `hejbro` gains the `@hejbro/query`
  workspace dependency; red test `packages/cli/test/exports.test.ts`
  "hejbro exports db and a single dual-use sql; fragment uses of the
  old sql still type-check"; files `packages/cli/src/index.ts`,
  `packages/cli/package.json`. ~10m
- [ ] 7.10 Smoke promotion: `@hejbro/query`/`@hejbro/pg` join
  `PACKAGES` (dist precheck + assertions 1a–1c), the interim
  file-wiring block is removed; the smoke passes locally end-to-end
  (`pnpm build` first); files `scripts/pack-install-smoke.sh`. ~8m
- [ ] 7.11 Changesets wiring: fixed group becomes the five-package set,
  the `privatePackages` entry is removed, this group's `minor`
  changeset added; `pnpm exec changeset status` exits 0 and its output
  shows all five aligning on the same next version; files
  `.changeset/config.json`, one new `.changeset/*.md`. ~6m
- [ ] 7.12 Docs: AGENTS.md repo-map rows for `@hejbro/query`/
  `@hejbro/pg`, root README query-layer section (facade import + chain
  UX example, driver install note, `compile()` preview); files
  `AGENTS.md`, `README.md`. ~8m
- [ ] 7.13 Spec deltas: query-builder gains the chain surface
  (thenable termination, inertness, `.compile()` preview, delegation
  to the single vocabulary), query-execution gains the three-surface
  uniformity sentence — every sentence traced to a named 7.x test; no
  loosening of group 5/6-owned sentences; verified by
  `openspec validate add-query-layer --strict`; files
  `openspec/changes/add-query-layer/specs/{query-builder,query-execution}/spec.md`.
  ~10m
