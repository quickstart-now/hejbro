---
"hejbro": minor
---

An exported `existingTable()` is now a declaration, not just a
reference — it reaches the snapshot (marked existing), the export
description, and a vendored contract's `Tables` entry, the same as a
managed table's shape does. `generateMigration` still diffs and emits
nothing for it, ever: adding, changing, or removing an existing
declaration produces no migration. A managed table's foreign key onto
an existing one resolves to a relation in the contract exactly as one
onto a managed table does; a reference to a table the schema does not
declare at all still has none. Preset validators (Supabase, Nile) skip
existing declarations — they judge managed DDL, not table references.

Handing a managed table to `existingTable()` emits nothing at all —
neither the table nor anything on it (its sequence, its row-level
security, its policies) is dropped. Adopting an `existingTable()` into
a managed `table()` the other way emits no `create table` for the
table itself, but everything the new declaration manages on it — a
serial column's sequence, row-level security, its policies — is
created exactly as it would be for any other managed table.
