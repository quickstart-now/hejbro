# Tasks: narrow-enum-columns

One group — the three files are a single type path (declaration → meta →
mapping) and splitting them would leave the tree red between tasks.
Estimates are pure work minutes (D88).

## 1. The declared values reach the type

- [x] 1.1 (~8m) [design] `pgEnum` generic over its values, with a
      `const` type parameter, and `EnumValues` (`readonly [string,
      ...string[]]`) exported as its constraint. The [design] part is
      where the values live once captured: on `ColumnMeta` as
      `enumValues?: string` (a literal union), the same shape `mode` and
      `jsonType` already use for compile-time-only column facts — never
      on `ColumnState`, so nothing reaches generated SQL or the
      snapshot. Red: `packages/query/test/types/select-result.test.ts`
      — "pgEnum().column() reads as its declared values" (the existing
      assertion, inverted from `string | null`). Files:
      `packages/core/src/dsl/pg-enum.ts`,
      `packages/core/src/types/column-builder.ts`,
      `packages/core/src/index.ts`, that test.
- [x] 1.2 (~6m) `BaseScalarTsType` reads `enumValues` for the `"enum"`
      case, falling back to `string` when absent (never `never`). Red:
      `packages/core/test/column-builder.test.ts` — the builder-type
      assertion now names `enumValues`. Files:
      `packages/core/src/types/ts-type-map.ts`, that test.
- [x] 1.3 (~6m) Write-side proof: the declared value is accepted, any
      other string is rejected. Red: `packages/core/test/query/
      mutate.test.ts` — "accepts a declared value and rejects any other
      string" (two `@ts-expect-error` directives that go *unused* — a
      compile error in themselves — the moment the narrowing regresses).
      Files: that test only.
- [x] 1.4 (~5m) `skills/hejbro/references/dsl-cheatsheet.md` gains the
      enum section it never had, stating both directions. Changeset
      (D59, `patch`). Files: that reference, `.changeset/*.md`,
      `openspec/task-times.csv`.

## Verification

- `pnpm check` clean, `pnpm check-types` 13/13, `pnpm test` 14/14.
- The write-side guard is self-verifying: `@ts-expect-error` on a line
  that stops erroring is itself an error, so 1.3 cannot pass while the
  narrowing is absent.
