---
"@hejbro/core": patch
---

`MutationRow` (the raw `insert()`/`update()` row type) no longer carries a key for a stored generated column or a `generated always as identity` column — matching the query layer's input types and the database's own refusal, so a write Postgres will certainly reject fails to compile instead of failing at runtime.
