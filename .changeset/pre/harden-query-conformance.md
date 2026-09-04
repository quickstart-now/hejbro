---
"@hejbro/core": patch
---

A whole-table projection in a select that also joins now renders its columns schema-qualified, the way the same select's object-projection form always has; a select with no join renders exactly the SQL it did before. `execute()` of a set operation built with the core builder's own combinators now reads back as the left branch's declared row shape instead of an untyped driver row.
