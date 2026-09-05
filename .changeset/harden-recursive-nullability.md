---
"@hejbro/core": patch
---

A recursive CTE's outward row now reads a key as nullable when either the anchor or the recursive term projects it nullable, closing a gap where a non-null anchor beside a nullable recursive term still typed the outward row as non-null even though a real `null` from the recursive term reaches the rows.
