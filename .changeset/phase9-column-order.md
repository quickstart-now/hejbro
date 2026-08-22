---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Fix: a function declared `returns: <table>` failed at call time (`structure of query does not match function result type`) — or silently returned values under the wrong column names when the swapped columns share a type — once a column had been added to that table in the middle of its TypeScript declaration in a later migration. Snapshot column order is now the table's physical order: existing columns keep their order, new columns are appended, a renamed column keeps its position — the rule Postgres applies. `select(table)` / `.returning()` lists in function bodies and view definitions follow it. No snapshot format change; unchanged declarations render unchanged. Known limitation: a snapshot that already diverged from the database on 0.1.0 (a mid-declaration insert generated before this fix) is not repaired — hejbro has no database access by design; regenerate that table's functions by hand once, or drop and re-add the column.
