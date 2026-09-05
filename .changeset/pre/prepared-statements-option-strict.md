---
"@hejbro/pg": patch
---

`preparedStatements` is read as `=== true`, so a non-boolean value from an untyped caller never lands in the declaration; a driver's `capabilities` object is frozen (D106 round 1 of add-prepared-statements, N3).
