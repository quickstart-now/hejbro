# query-builder (delta)

## ADDED Requirements

### Requirement: Selects paginate and de-duplicate
A select SHALL support `offset`, `distinct`, and `distinct on (...)`.

`offset` SHALL be available after `limit` and on its own (a bare `offset`
is legal SQL), SHALL accept only a non-negative integer, and SHALL render
inline after `limit` — never as a bind parameter, the same rule `limit`
already follows, so the compiled statement stays reviewable. A set
operation SHALL carry a whole-set `offset` exactly as it already carries a
whole-set `limit`.

`distinct` and `distinctOn` SHALL be available only on the stage `select`
itself returns and exactly once, matching SQL's own placement between
`select` and the projection. `distinctOn` SHALL require at least one
column and SHALL render its columns before the projection; which row of
each group survives is decided by the statement's `order by`, as Postgres
defines it.

#### Scenario: A page is taken by the database
- **WHEN** a select chains `limit` then `offset`
- **THEN** the compiled SQL ends `limit <n> offset <m>` with both values
  inline and no parameters added, and the database returns exactly that
  page

#### Scenario: An offset without a limit compiles
- **WHEN** a select chains `offset` without `limit`
- **THEN** the compiled SQL carries the `offset` clause alone

#### Scenario: A negative or fractional row count is refused
- **WHEN** `limit` or `offset` is called with a negative or fractional
  number
- **THEN** the call fails immediately, naming the clause and the
  non-negative-integer rule

#### Scenario: distinct on takes one row per group
- **WHEN** a select applies `distinctOn` over a column and orders by that
  column followed by a descending tiebreaker
- **THEN** the compiled SQL renders `select distinct on (<column>)` before
  the projection, and the database returns one row per group — the one the
  ordering puts first

#### Scenario: distinct is settable once, first
- **WHEN** a chain has already joined, filtered, or ordered
- **THEN** `distinct`/`distinctOn` are not available on that stage, so a
  placement SQL would reject cannot be written
