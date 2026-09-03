# Proposal: projection-declared-types

## Why

Projecting columns is how anyone reads a subset of a table or writes a
join, and the moment a projection is used the types collapse to their
SQL family (#311):

| projection | field type today |
|---|---|
| `select(posts)` | `amount: bigint \| null` |
| `select({ amount: posts.amount }, posts)` | `amount: number \| bigint \| string \| null` |
| `insert(posts).returning({ id: posts.id })` | `id: string \| null` |

A `bigint({ mode: "bigint" })` column reads back as
`number | bigint | string`, a `jsonb().$type<Payload>()` column as
`unknown`, an array column as `ReadonlyArray<unknown>`. Since an object
projection is the only way to write a join, every join's result type is
imprecise, and callers reach for `!` on values the declaration already
described exactly.

`select-result.ts` documented the cause as "a `ColumnRef` doesn't
remember which declared column it came from". That stopped being true
when `add-relational-reads` landed: `TableColumns` stamps every built
table's column ref with `OriginBrand<TColumns, K>` — the declaring
column map and key, at the type level — which is how `.references()`
infers its target edge. The link exists; the inference just never read
it.

Worth stating plainly: **the runtime was already correct**. An object
projection's `ColumnRefNode` resolves back to its declared column state
in `convert.ts`, so a projected mode-`bigint` column has always
*arrived* as a `bigint`. The widened type was wider than the values it
described.

## What Changes

- **A projected declared column carries its declared read type.**
  `SelectResult`'s object-projection branch recovers the declaring
  `ColumnBuilder` through the origin brand and resolves it through the
  same `ColumnTsType` mapping a whole-table select uses — numeric mode,
  array element, `$type` brand included. `ReturningRow` reuses
  `SelectResult`, so `returning({...})` improves with it, unchanged.
- **Anything that is not a declared column reference is untouched** — a
  `sql` fragment or computed expression still resolves to its family.
  The recovery is structural (the brand), never a name match against the
  source table: two same-named columns of the same family prove nothing
  about which column an expression reads.
- **Nullability is deliberately not narrowed.** Every object-projection
  field stays `| null`.

## Capabilities

### Modified Capabilities

- `query-type-inference`: the object-projection requirement splits into
  a declared-column arm (full declared type) and an
  everything-else arm (family), with the nullability rule stated
  explicitly and attributed to #307.

## Impact

- **Affected code**: `packages/query/src/types/select-result.ts`
  (the whole change), `packages/core/src/index.ts` (exports
  `columnOriginBrand`/`OriginBrand`, previously internal),
  `skills/hejbro/references/query-layer.md`.
- **Runtime**: none. No conversion changes; a test pins the existing
  behavior as this change's soundness witness.
- **Breaking**: types narrow. Code that stored a projected field in a
  variable annotated with the old wide union still compiles (the narrow
  type is assignable to it); code that *produced* such a union to feed a
  projection field does not exist — these are read types.
- **Decision log**: no new row.

## Why nullability is out of scope

A projection's type is fixed at `select()` time; `.leftJoin()` is
chained after it and returns the same `TProjection`. Narrowing a
`notNull` column's projected field to non-null would therefore be wrong
for exactly the queries object projections exist to write. Making it
right means threading "which tables were left-joined" through the chain
and giving each projected field its source table — that is #307, and it
is a chain-surface change, not an inference-mapping one. Doing the type
axis first is what makes #307 purely about nullability when it lands.

Stated the other way: this change removes the imprecision that was
never load-bearing, and leaves the one widening that is.
