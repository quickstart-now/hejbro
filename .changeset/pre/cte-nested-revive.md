---
"@hejbro/query": patch
---

A nested read (`jsonArrayFrom`, `jsonObjectFrom`, `related`) projected inside a CTE body and read back through the CTE's column is revived — `bigint`, `timestamptz` and aggregate cells arrive as their declared types instead of the cast's text (D106 round 1 of harden-aggregate-vocabulary, B1).
