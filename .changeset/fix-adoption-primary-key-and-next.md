---
"@hejbro/core": patch
"hejbro": patch
---

Adoption now creates a table's declared primary key even when the
`existingTable()` declaration it replaces already listed the same
primary key — previously the migration silently skipped it while
`adoption-creates` still named it, leaving a drift `hejbro check` could
report but no later `generate` could repair. The migration's own
banner also names the primary key on every adoption that creates one,
instead of no note list at all.

`hejbro generate`'s `adoption-creates` notice is rewritten: its first
sentence now names exactly the objects a database already holding them
makes apply fail on — an index, a check, a foreign key or the primary
key (a held sequence is reused, and row-level security and policies
are re-applied without failing). Its `Next:` line no longer suggests
`hejbro baseline`, which can never run at this point
(`error[baseline-not-first]` always refuses once an adoption's own
prior snapshot exists) — it now names the two ways that actually run
on the database the adoption just touched: handing the table back
(restoring the migration, the snapshot and the `existingTable()`
declaration), or dropping the indexes, checks, foreign keys and
primary key the database already holds (never the sequence, which is
reused) before applying.
