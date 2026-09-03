---
"hejbro": patch
---

`hejbro reset` on a database that was never migrated by hejbro (every migration applied via `psql -f` or another external pipeline, so `hejbro.migration_ledger` never existed) now drops the declared objects instead of reporting success and doing nothing. A failed drop's coded `reset-drop-failed` error now also carries the database's own `DETAIL` line, and correctly names a mutually-referencing declared pair as the dependent instead of always blaming an object outside your declarations.
