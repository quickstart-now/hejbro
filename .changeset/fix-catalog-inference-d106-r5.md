---
"hejbro": patch
"@hejbro/core": minor
---

`@hejbro/core` exports `isSqlName` (the same D36 rule `assertSqlName`
enforces, as a boolean query), so a caller that must decide whether a
name is declarable has one rule to ask, not a second, hand-rolled copy
of it. `import`/`pull` now use it to decide the same question `table()`
itself already enforces: a column whose SQL name begins with an
underscore (`_id`) round-trips through its own TypeScript key but is
not a valid hejbro identifier, and used to abort the entire reading;
it is now omitted and named in the loss report instead, like every
other name a declaration cannot carry.
