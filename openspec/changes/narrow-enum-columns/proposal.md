# Proposal: narrow-enum-columns

## Why

`pgEnum(app, "post_status", ["draft", "published"]).column()` types as
bare `string` in both directions: the read type is `string` and any
string type-checks as a write, so `status: "not-a-real-status"` compiles
and the database rejects it at runtime (#422).

The values are at the call site. `pgEnum` simply is not generic over
them — `values: ReadonlyArray<string>` widens the tuple away before any
type can read it — and `column()` returns a fixed
`ColumnBuilder<"text", { typeName: "enum" }>`.

This is the one column type in the DSL that discards information the
declaration already carries. Every other honesty rule in the surface
(array element nullability under D99, `jsonb` staying `unknown` until
branded, `numeric({mode})` round-tripping, identity/generated columns
excluded from writes) either tells the truth or refuses to guess. Here
the truth is available and unused, and the only workaround is for the
user to restate the same list as `.$type<"draft" | "published">()` —
duplicating the declaration, which is what a single-declaration design
exists to prevent. Drizzle narrows enum columns.

## What Changes

- **`pgEnum` becomes generic over its values**, with a `const` type
  parameter so the argument keeps its literals instead of widening to
  `string[]`. `EnumDeclaration<TValues>` carries them; a bare
  `EnumDeclaration` still means "some enum" for consumers that don't
  care (`HejbroDeclaration`, the Supabase validators' narrowing).
- **The values ride on the column's meta.** `ColumnMeta` gains
  `enumValues?: string` — the literal union — set only by
  `pgEnum(...).column()`. `BaseScalarTsType`'s `"enum"` case reads it
  and falls back to `string` when absent, so an enum column with no
  recorded values keeps the type it has today rather than collapsing to
  `never`.
- **Both directions narrow at once.** `MutationValue` resolves through
  `ColumnReadType`, so the write type follows the read type with no
  second mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-type-inference`: an enum column's read type and its write
  input type are its declared values, not `string`.

## Impact

- **Affected code**: `packages/core` (`dsl/pg-enum.ts`,
  `types/column-builder.ts`'s `ColumnMeta`, `types/ts-type-map.ts`'s
  scalar mapping, the barrel's `EnumValues` export), `skills/hejbro`
  (the cheatsheet documented no enum surface at all).
- **Runtime**: none. `enumValues` is type-level only — it never reaches
  `ColumnState`, generated SQL, or the snapshot, exactly like `mode`'s
  compile-time half and the `$type` brand.
- **Breaking**: a source-level narrowing. Code that assigns an
  arbitrary `string` to an enum column stops compiling — which is the
  defect being fixed, and the database rejected those values already.
  Code that reads an enum column into a `string` keeps working (the
  union is assignable to `string`).
- **Decision log**: no new row. This applies the existing honesty rule
  (D1/D3/D5's "the declared type is the visible type") to the one
  column factory that was not carrying it.

## Note on the previous behavior

`packages/query/test/types/select-result.test.ts` asserted "pgEnum().
column() reads as string" as a deliberate `add-query-layer` scope cut
("planner addition 4"). No spec requirement pinned it — the assertion
recorded the implementation, not a contract — so this change updates
that test rather than amending a settled decision.
