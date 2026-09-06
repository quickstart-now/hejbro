---
"@hejbro/core": minor
---

Adopting an `existingTable()` back into a managed `table()` now also
creates the table's own declared index, check constraint, foreign key
and primary key, alongside the sequence, row-level security and
policies it already created. A serial column's sequence is normalized
idempotently — `create sequence if not exists`, then altered to the
declared type and ownership — so re-adopting a table whose only managed
object is that sequence no longer fails with a duplicate-sequence
error. `hejbro generate` names every object an adoption will create
with a `warning[adoption-creates]` diagnostic, pointing at `hejbro
baseline` for a database that already holds one of them.
