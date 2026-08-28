# Proposal: write-json-and-bytea

## Why

`jsonb` is not an edge case in a Postgres application — it is where
settings, metadata and payloads live, and in a Supabase-shaped app it is
in most tables. hejbro could read one exactly (`jsonb().$type<T>()`
revives as `T`) and could not write one at all: the write type was
`Expr` only, so every insert became

```ts
await db.insert(users).values({ settings: sql`${JSON.stringify(v)}::jsonb` });
```

— manual serialization plus a manual cast, which is the work an ORM
exists to do. `bytea` was in the same position.

The gate was deliberate (#322's STRICT rule), and its reasoning holds
where it was aimed: `liftLiteral` cannot tell a Postgres array from a
jsonb document by looking at a bare JS object, so the *declaration* path
refuses to guess. But a mutation is not that situation. `liftColumnValue`
already receives the column's own `TypeNode` and already dispatches on it
for arrays and intervals. The ambiguity STRICT protects against does not
exist here, because the declaration already answered it.

## What Changes

- **`json`/`jsonb` columns accept any JSON-serializable value**,
  serialized by the query layer. The literal node carries WHICH of the
  two types it was declared as: rendering a `json` column's value through
  a `::jsonb` cast would apply jsonb's key reordering and
  duplicate-stripping to a column whose whole point is that it does not
  do that.
- **`bytea` columns accept a `Uint8Array`**, hex-encoded. A string is
  still refused — its encoding would have to be guessed.
- **The brand narrows writes too.** `MutationValue` resolves through
  `ColumnReadType`, so `jsonb().$type<T>()` now accepts `T` and nothing
  wider, the mirror of the brand narrowing its read.
- **Arrays of `json`/`jsonb`/`bytea` stay `Expr`-only.** Those element
  types need their own array-literal escaping rules; the scalar path is
  what this change opens.
- **Neither literal kind can reach a snapshot.** Both join `bigint`/
  `interval`/`array` in the codec's non-snapshot set, so the existing
  loud `non-snapshot-literal` failure covers them by construction.

## Capabilities

### Modified Capabilities

- `query-type-inference`: the write-acceptance rule, per column type,
  including the brand's effect on writes.

## Impact

- **Affected code**: `packages/core` (`expr/ast.ts`'s `LiteralNode`,
  `expr/literal.ts`'s renderers, `expr/codec.ts`'s non-snapshot set,
  `query/column-value.ts`'s two new lifts, `query/mutate.ts`'s gate),
  `packages/query` (`compile/params.ts`), `skills/hejbro`.
- **Breaking**: none in the accepting direction. Code that wrote a
  `sql` fragment keeps working; code that could not compile now can.
- **Decision log**: no new row. #322's STRICT rule is unchanged — this
  narrows where it applies to the situation it was reasoning about (a
  value with no declared type in reach), which the mutation path is not.

## Verification note

The claim worth proving is not that the SQL looks right but that the
value survives: the live witness writes a branded `jsonb`, a `json`, and
a `Uint8Array` to a real postgres:17 and reads all three back equal.
Asserting one byte differently fails, so the witness measures the round
trip rather than restating the encoder.
