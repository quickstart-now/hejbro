---
"hejbro": patch
---

A managed table's own removal, paired with a same-shaped
`existingTable()` declaration appearing under a different name in the
same schema and run, no longer drops the managed table's DDL (its
table, sequence, row-level security, policies) without asking —
`hejbro generate` now refuses it with `ambiguous-table-rename`, the
same way it already refuses two managed tables in that shape. The safe
path is two runs: `--rename` the table while both sides are still
`table()` declarations, then hand the renamed table over to
`existingTable()` in a later run. `--rename` targeting a declaration
that's already `existingTable()` is refused too, with a message that
says the target is declared but not DDL-owned rather than "unknown."
