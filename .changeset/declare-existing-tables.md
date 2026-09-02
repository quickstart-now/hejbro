---
"hejbro": minor
---

An exported `existingTable()` is now a declaration, not just a
reference — it reaches the snapshot (marked existing), the export
description, and a vendored contract's `Tables` entry, the same as a
managed table's shape does. `generateMigration` diffs nothing about an
existing table's own identity and emits no statement for it: adding
one, changing its declared columns, renaming it, or removing the
declaration entirely all produce no migration naming that table, and
none of them can block or refuse an unrelated managed change in the
same schema either. A managed table's foreign key onto an existing one
resolves to a relation in the contract exactly as one onto a managed
table does; a reference to a table the schema does not declare at all
still has none. Preset validators (Supabase, Nile) skip existing
declarations — they judge managed DDL, not table references.

Handing a managed table to `existingTable()` emits nothing at all —
neither the table nor anything on it (its sequence, its row-level
security, its policies) is dropped. Adopting an `existingTable()` into
a managed `table()` the other way emits no `create table` for the
table itself, and creates exactly three things a handover also spares
— a serial column's sequence, row-level security, its policies. It does
not yet create the declaration's own indexes, check constraints,
foreign keys, or primary key, even though the snapshot afterwards
records them as if it had (#671).
