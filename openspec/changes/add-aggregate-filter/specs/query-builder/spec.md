## MODIFIED Requirements

### Requirement: Selects aggregate and group
The builder SHALL provide the aggregate vocabulary — `count()`, `min`,
`max`, `sum`, `avg` — and the `groupBy` and `having` stages.

`groupBy` SHALL be available after `where` and SHALL require at least one
expression. `having` SHALL be available only after `groupBy`, and
`orderBy`/`limit`/`offset` SHALL still follow it: the chain admits
exactly SQL's own clause order, so a placement Postgres would reject is
not expressible.

Aggregates SHALL render as Postgres's own function names, with
`count()` rendering `count(*)`. A `FILTER (WHERE …)` clause SHALL be
written as one wrapper, `filter(aggregate, condition)`, over any of the
five aggregates: it renders Postgres's own `<aggregate> filter (where
<condition>)`, keeps the aggregate's own result type and conversion,
lifts a runtime value in the condition to a bind parameter as `where`
does, and composes with a window as SQL orders them —
`over(filter(count(), condition), spec)`. There is no separate
filtered-count constructor. `filter` over anything that is not a builder
aggregate — a column, a computed expression, a declared function call, a
window-only function, a windowed expression — SHALL be refused at build
time with `filter-not-aggregate`, naming the five constructors it
accepts.

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

#### Scenario: A filtered aggregate renders Postgres's own clause
- **WHEN** a select projects `filter(count(), eq(posts.status,
  "published"))`, `filter(sum(posts.views), gt(posts.views, 10))` and
  `filter(avg(posts.views), isNull(posts.deletedAt))`, and one of them
  windowed through `over`
- **THEN** each compiles to `<aggregate>(…) filter (where …)` with the
  condition's values as bind parameters, the windowed one appends
  `over (…)` after the filter clause, and each projected field keeps
  the aggregate's own result type

#### Scenario: filter over a non-aggregate is refused at build time
- **WHEN** `filter` wraps a column reference, `sql\`1\``, a `db.fn`
  call, `rowNumber()` and `over(count(), spec)`
- **THEN** each fails immediately with `filter-not-aggregate`, naming
  the five aggregate constructors, and nothing is rendered
