# query-builder (delta)

## ADDED Requirements

### Requirement: Selects aggregate and group
The builder SHALL provide the aggregate vocabulary — `count()`,
`countWhere(expr)`, `min`, `max`, `sum`, `avg` — and the `groupBy` and
`having` stages.

`groupBy` SHALL be available after `where` and SHALL require at least one
expression. `having` SHALL be available only after `groupBy`, and
`orderBy`/`limit`/`offset` SHALL still follow it: the chain admits
exactly SQL's own clause order, so a placement Postgres would reject is
not expressible.

Aggregates SHALL render as Postgres's own function names, with
`count()` rendering `count(*)`.

#### Scenario: Grouping with a group filter
- **WHEN** a select projects a column and `count()`, filters rows with
  `where`, groups by that column, filters groups with `having`, then
  orders and limits
- **THEN** the compiled SQL carries `where`, `group by`, `having`,
  `order by` and `limit` in that order, and the database returns only the
  groups `having` kept

#### Scenario: An empty group by is refused
- **WHEN** `groupBy()` is called with no expressions
- **THEN** it fails immediately, naming what to pass

#### Scenario: having is unavailable without grouping
- **WHEN** a chain has not called `groupBy`
- **THEN** `having` is not on that stage
