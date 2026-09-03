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

`import`/`pull` no longer abort when a foreign key's own *target*
table or schema has a name a declaration cannot carry: that one
relation is left out and named in the loss report (its own name is
still declared as a column), and the rest of the database is still
read. A `UNIQUE` constraint on an omitted table is no longer announced
as an approximation for an object the same report says was never
inferred, and a database whose named schemas are all omitted for their
own names now refuses with its own diagnostic -- naming the reason in
the loss report first -- instead of the misleading "found no table,
enum, or sequence to infer": that message is now reserved for schemas
that genuinely hold nothing, never for one hejbro just couldn't name.
Either way, nothing is written and the `--out` directory is never
created.

Two tables in the same schema that each carry a check constraint of
the same name no longer swap expressions: `import`/`pull` used to
attach the wrong table's own check condition to whichever table came
second, so the starter file declared a check asserting against columns
that table doesn't have -- DDL the source database itself refused.
Each table's own check expression is now read correctly, regardless of
what its check constraints happen to be named.
