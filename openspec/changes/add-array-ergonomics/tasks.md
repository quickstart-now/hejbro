# Tasks — add-array-ergonomics

Groups are parallel-safe pieces (no file overlap between groups; group 3
consumes group 1's `columnState` flag, so it starts after group 1's
piece PR merges — file-disjoint, order-dependent). Every contract
detail (method name, check name/expression, error codes/messages,
utility shape) was owner-settled in the proposal/design (2026-08-28
AskUserQuestion trail), so no task carries `[design]`. Estimates
consult `openspec/task-times.csv` (type-assertion tasks run 5–8m
measured; vitest has no typecheck, so type tasks verify through
`check-types`).

## 1. Declaration surface and type narrowing (core)

- [x] 1.1 (~8m) `TMeta`/`columnState` flag + `.notNullElements()`
      method + misuse throw. Red:
      `packages/core/test/types/column-builder.test.ts` (or the file
      that holds builder-chain tests) — "notNullElements flags the
      meta and throws `invalid-not-null-elements` on a non-array
      builder". Files: `packages/core/src/types/column-builder.ts`,
      `packages/core/src/dsl/table.ts` (the misuse validation lives at
      `table()`, where the column name exists), the builder-chain
      implementation file, its tests.
- [x] 1.2 (~7m) Read/write element narrowing under the flag. Red:
      core `test/inline-inference.test.ts` (or a new
      `not-null-elements.test.ts`) — "`text().array().notNullElements()`
      reads `ReadonlyArray<string>`, writes reject `null` elements;
      the brand-array branch narrows the same way". Files:
      `packages/core/src/types/ts-type-map.ts`,
      `packages/core/src/types/column-builder.ts` (ColumnReadType),
      core type tests.
- [x] 1.3 (~9m) `table()` derives the CHECK
      (`<column>_no_null_elements`,
      `array_position("<column>", null) is null`) into the checks
      list; duplicate-name collision fails loudly (verify the existing
      guard covers checks; add if absent). Red:
      `packages/core/test/` table/check test — "notNullElements emits
      the named check into the migration" + a golden/emit assertion
      with the exact SQL text. Files: `packages/core/src/dsl/table.ts`,
      table/check kind tests.

## 2. assertNoNulls (core utility + exports)

- [x] 2.1 (~7m) `assertNoNulls` implementation
      (`throwHejbroError("null-array-element", …)` naming the first
      null index), core barrel export, `hejbro` facade re-export. Red:
      new `packages/core/test/assert-no-nulls.test.ts` — clean array
      narrows; null at index 2 throws naming index 2; plus the facade
      export assertion in the cli barrel test. Files:
      `packages/core/src/types/assert-no-nulls.ts` (new),
      `packages/core/src/index.ts`, cli barrel re-export site + its
      test.

## 3. Conversion guard (query) — after group 1 lands

- [x] 3.1 (~6m) `convertArrayValue` fails fast on a `null` element
      when the column's `columnState` carries the flag
      (`result-conversion-failed`, existing family). Red:
      `packages/query/test/db/convert.test.ts` — "a NULL element under
      notNullElements rejects naming the column; a plain array column
      still passes it through as null". Files:
      `packages/query/src/db/convert.ts`, its test.

## 4. Real-server witness (pg integration) — after groups 1–3 land

- [ ] 4.1 (~9m) Integration column
      `labels: text().array().notNullElements()`: DDL carries the
      CHECK (create table from the generated shape), a null-element
      insert is rejected by the database (CHECK violation surfaced via
      `query-execution-failed`), the clean round-trip reads
      `ReadonlyArray<string>`, and `assertNoNulls` narrows a plain
      column's read in the same test. Red: extend
      `packages/pg/test/integration.test.ts`. Files: that file only.
