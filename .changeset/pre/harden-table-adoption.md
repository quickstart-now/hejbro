---
"@hejbro/core": minor
"hejbro": minor
---

Adopting an `existingTable()` back into a managed `table()` now also
creates the table's own declared index, check constraint, foreign key
and primary key, alongside the sequence, row-level security and
policies it already created. A serial column's sequence is normalized
idempotently — `create sequence if not exists`, then altered to the
declared type and ownership — so re-adopting a table whose only managed
object is that sequence no longer fails with a duplicate-sequence
error.

`hejbro generate` names every object an adoption will create with a
`warning[adoption-creates]` diagnostic, one block per adopted table the
migration creates something for; a table with nothing to create is
adopted silently. The block names both apply-time risks — an object the
database already holds, and a column the database lacks that one of
these objects needs, which `hejbro check --url <url>` names before you
migrate — and its `Next:` offers both ways through: `hejbro baseline`
for a database that already holds the objects, or discarding this run's
migration and snapshot and adopting with the columns the database has.
