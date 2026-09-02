---
"@hejbro/core": minor
"@hejbro/query": minor
---

A mutation chain that never calls `.returning()` now resolves to
`ReadonlyArray<never>` instead of the table's row type. The runtime
value was always an empty array (the statement carries no `returning`
clause, and hejbro never adds one implicitly); the type now says so, so
code that read rows off `await db.insert(t).values(row)` fails to
compile where it previously compiled and read `undefined`. Call
`.returning()` or `.returning({ … })` to get rows back. `.returning()`
with no projection still resolves every declared column. The bare type
names (`InsertFinal<T>`, `InsertChainFinal<T>`, `ReturningRow<T>`, and
their update/delete counterparts) keep meaning every declared column;
only the stage a chain sits at before `.returning()` carries the
never-requested instantiation.
