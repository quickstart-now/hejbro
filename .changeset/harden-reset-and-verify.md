---
"hejbro": patch
---

`hejbro reset` now orders its drops by the declared tables' own foreign keys, so a table referenced by another declared table drops after its dependent instead of failing on an arbitrary alphabetical order; a drop the database refuses (something outside your declarations still depends on what's being dropped) is now reported as a coded `reset-drop-failed` error with the transaction rolled back, instead of an uncaught crash — the database and the migration ledger are left exactly as they were. `hejbro verify` now also runs any registered preset validators as an additional check, refusing a declaration with the same coded error `hejbro generate` itself would report for it, rather than passing a declaration `generate` would refuse.
