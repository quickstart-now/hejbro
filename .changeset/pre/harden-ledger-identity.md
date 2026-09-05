---
"hejbro": patch
---

`migrate`, `status`, `reset` and `raise` now recognize hejbro's ledger by identity, not by the existence of anything at `"hejbro"."migration_ledger"`: a table of another shape, a view, a materialized view, a foreign table, a sequence or a partitioned table at that name is refused with `apply-ledger-occupied` and left untouched — `reset` no longer deletes the rows of an unrelated table under that name, `status` no longer crashes with a raw error, and `migrate` never writes into a table it did not create. `reset`'s dependency advice now recognizes a cycle of any length among the declared tables, not only a mutually referencing pair.
