---
"@hejbro/core": minor
---

Window functions: `over(target, spec)` attaches a `partitionBy`/`orderBy`
window specification to an existing aggregate (`count()`, `sum(x)`,
`min(x)`, `max(x)`, `avg(x)`) or one of eleven new window-only
constructors — `rowNumber`, `rank`, `denseRank`, `percentRank`,
`cumeDist`, `ntile`, `lag`, `lead`, `firstValue`, `lastValue`, `nthValue`.
A window-only call has no meaning on its own; it only type-checks once
`over()` wraps it. `rowNumber`/`rank`/`denseRank` read back as `bigint`
(Postgres's own `int8`), `percentRank`/`cumeDist`/`ntile` as `number`,
and `lag`/`lead`/`firstValue`/`lastValue`/`nthValue` as their argument's
own declared type. Windows render under Postgres's default frame — frame
clauses stay out of scope (#416). `where`/`groupBy`/`having`, an
aggregate's own argument, and every declaration site that stores an
expression (a column default, a generated column, an index expression or
predicate, a check constraint, an RLS policy) reject a window function
with a build-time diagnostic instead of a raw driver error.
