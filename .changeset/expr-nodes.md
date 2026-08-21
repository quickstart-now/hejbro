---
"@hejbro/core": minor
---

Column defaults, CHECK expressions, partial index `where` predicates,
and policy `using`/`withCheck` clauses are now stored in the snapshot
as structured expression nodes (D67/D70) instead of pre-rendered SQL
text. This is what lets a table or column rename retarget the
identifiers inside these expressions exactly — including across
tables, when a policy reaches another table through `exists()` —
instead of leaving stale text behind. Rendered SQL output is
unaffected: the same `renderExpr` produces the same text at emit
time, now from a decoded node instead of a stored string. Snapshot
shape changes for tables/policies that declare any of these four
expression kinds; existing snapshots keep working (no format-version
bump — this wave's version already opened the door for this in
`phase8-snapshot-v5`).
