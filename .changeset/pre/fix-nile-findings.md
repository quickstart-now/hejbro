---
"@hejbro/core": patch
---

A table-bound expression's column reference — a CHECK constraint, a
partial index predicate, an index expression, a generated column's
expression, or a policy's `using`/`with check` — now renders
`"table"."column"` instead of schema-qualified, including one inside a
correlated `exists()` subquery. A platform that keeps a tenant-aware
table under an internal schema name (Nile) rejects the schema-qualified
form outright; the two-part form is accepted everywhere and keeps the
table visible to a reviewer. A view body and a query-builder statement
are unaffected.
