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

- [ ] 2.1 [design] `compile()` result shape and parameter numbering
  rule (ordered params, deterministic output); red test
  `packages/query/test/compile/compile.test.ts` "same statement
  compiles byte-identical twice, no connection"; files
  `src/compile/compile.ts`. ~10m
- [ ] 2.2 Select rendering: explicit projection, from, where via
  ExprNode with literal→parameter lifting; red test
  `packages/query/test/compile/select.test.ts` "select with where
  compiles to parameterized SQL, no star"; files
  `src/compile/select.ts`, `src/compile/params.ts`. ~10m
- [ ] 2.3 Order/limit rendering; red test
  `packages/query/test/compile/select.test.ts` "order and limit render
  after where"; files `src/compile/select.ts`. ~6m
- [ ] 2.4 Join rendering with schema-qualified explicit columns; red
  test `packages/query/test/compile/join.test.ts` "left join renders
  left join … on with qualified columns"; files
  `src/compile/select.ts`. ~8m
- [ ] 2.5 Insert/update/delete rendering with explicit `returning`; red
  test `packages/query/test/compile/mutation.test.ts` "insert renders
  parameterized values and explicit returning"; files
  `src/compile/mutation.ts`. ~10m
- [ ] 2.6 [design] `sql` tagged template: statement and fragment forms,
  value interpolation → bind parameters, structural composition of
  fragments/identifiers; red test `packages/query/test/sql.test.ts`
  "interpolated value becomes a parameter, never a literal"; files
  `src/sql.ts`. ~10m

## 3. Type inference

- [ ] 3.1 [design] Declared SQL type family → TypeScript mapping table
  (settles the visible type per column type); red type test
  `packages/query/test/types/column-map.test-d.ts` "each declared
  family maps to its TS type"; files `src/types/column-map.ts`. ~10m
- [ ] 3.2 Select result inference: projection subset + notNull
  nullability; red type test
  `packages/query/test/types/select-result.test-d.ts` "projection
  drives the row type"; files `src/types/select-result.ts`. ~10m
- [ ] 3.3 Left-join nullability widening; red type test
  `packages/query/test/types/select-result.test-d.ts` "left-joined
  notNull column types T | null"; files `src/types/select-result.ts`.
  ~8m
- [ ] 3.4 Insert/update input types (required iff notNull without
  default/generated); red type test
  `packages/query/test/types/insert-input.test-d.ts` "defaulted column
  is optional on insert"; files `src/types/insert-input.ts`. ~10m
- [ ] 3.5 [design] `$type` jsonb brand on the column DSL (additive,
  type-level only — core runtime untouched); red type test
  `packages/query/test/types/jsonb.test-d.ts` "unbranded jsonb is
  unknown, branded type flows through"; files core column DSL type
  surface + `src/types/column-map.ts`. ~10m
- [ ] 3.6 `returning` rows reuse select inference; red type test
  `packages/query/test/types/returning.test-d.ts` "returning rows typed
  like a projection"; files `src/types/returning.ts`. ~6m

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
