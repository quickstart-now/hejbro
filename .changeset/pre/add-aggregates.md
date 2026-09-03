---
"@hejbro/core": minor
---

Selects aggregate and group. `count()`, `countWhere(expr)`, `min`, `max`,
`sum` and `avg`, with `groupBy(...)` and `having(condition)` in SQL's own
clause order — `having` exists only after `groupBy`, and
`orderBy`/`limit`/`offset` still follow it.

The result types match what arrives: `count` is a `bigint` (converted,
not the text the driver hands back for `int8`), `min`/`max` keep their
argument's own declared type, and `sum`/`avg` stay at the numeric
family's widest honest type because Postgres promotes them by the
argument's exact type. Window functions remain tracked in #416.
