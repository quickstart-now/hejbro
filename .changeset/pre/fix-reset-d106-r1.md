---
"hejbro": patch
---

`hejbro reset` on a database that was never migrated by hejbro (every migration applied via `psql -f` or another external pipeline, so `hejbro.migration_ledger` never existed) now drops the declared objects instead of reporting success and doing nothing. Its coded `reset-drop-failed` error now names which step actually failed (dropping the objects or clearing the ledger afterward) instead of always claiming a failed drop, carries the database's own `DETAIL` line, and — only when the run's own declared objects include a pair that reference each other — adds that possibility alongside the existing one (an object outside your declarations), without asserting either as the cause: the server's own `DETAIL` is what names the actual dependent.
