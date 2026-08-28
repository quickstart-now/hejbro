# Proposal: add-aggregates

## Why

`count(*)` had no expression in the builder. The escape hatch produced
`Expr<"unknown">`, so a dashboard's most basic query — how many rows per
group — read back as `unknown` and arrived as the string `"2"`. There
was no `group by` and no `having` at all.

This is the half of #416 that is table stakes rather than advanced.
Window functions (`over(...)`) are the other half and stay there: they
carry a parked IR decision (whether a window is its own node or a field
on the function call) that is worth settling on its own, and nothing
about aggregates depends on it.

## What Changes

- **The aggregate vocabulary**: `count()`, `countWhere(expr)`, `min`,
  `max`, `sum`, `avg`, rendered as Postgres's own function names.
- **`groupBy(...)` and `having(condition)`** as stages in SQL's own
  order — `where` → `groupBy` → `having` → `orderBy` → `limit` →
  `offset`. `having` exists only after `groupBy`; a placement Postgres
  would reject is not expressible.
- **Result types that match what arrives.** `count` declares `bigint`
  through a new phantom read-type brand *and* the conversion path
  synthesizes the matching column state, so the value really is a
  `bigint`. `min`/`max` return their argument's own type — more precise
  than any brand, since the argument may carry a declared column's
  origin. `sum`/`avg` stay at the numeric family's widest honest type.

## Capabilities

### Modified Capabilities

- `query-builder`: the aggregate vocabulary and the two new stages.
- `query-type-inference`: what a projected aggregate reads back as, and
  the rule that a declared result type must be backed by the conversion.

## Impact

- **Affected code**: `packages/core` (`expr/aggregate.ts` new,
  `expr/ast.ts`'s `SelectNode`, `expr/render-sql.ts`, `expr/codec.ts`,
  `query/select.ts`'s stages), `packages/query`
  (`types/select-result.ts`'s read-type arm, `db/convert.ts`'s
  aggregate conversion, `db/chain.ts`'s stages), `skills/hejbro`, the
  goldens and both examples' committed chains.
- **Breaking**: none in the API. The snapshot shape grows (see below).
- **Decision log**: no new row.

## Snapshot: extending 8 in place

`SelectNode` gains `groupBy` and `having`, and a view body is a
serialized select — so this is the second shape change inside format 8.
It **extends 8 rather than bumping to 9**, which is what
`add-offset-and-distinct`'s own proposal said should happen: 8 has never
been published (npm has 5, and 0.2.0 has not shipped), so no artifact
outside this repository carries it, and a second reset inside the same
pre-release window would cost contributors a regeneration for nothing.

The first shape change *after* 0.2.0 ships is the one that bumps, and it
is the one #413 exists to make survivable.

In-repo the cost is the same as last time and was paid the same way: the
goldens regenerated, and both example chains replayed to rewrite their
snapshots and every migration's two banner hash lines.

## Why sum and avg are not narrowed

Postgres promotes them by the argument's exact type — `sum(int4)` is
`int8`, `sum(int8)` is `numeric`, `avg(int)` is `numeric`,
`avg(float8)` is `float8`. Declaring one result type would be wrong for
most inputs, and declaring it *with* a conversion would make the value
wrong too, not just the type. Modeling that promotion is a follow-up
worth doing deliberately; widening honestly is the correct interim, and
it is what the family already does for every other computed expression.

## Out of scope

- Window functions (`over(...)`) — #416's other half.
- `sum`/`avg` result promotion, as above.
- `count(distinct x)` — `distinctOn` covers the row-level case this
  change's sibling added, and a distinct aggregate argument is its own
  small grammar addition.
