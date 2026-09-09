---
"hejbro": patch
---

A set operation returned as the body of `db.with(...)` now reads back as the union of its branches (a column nullable only in the right branch reads nullable, a column declared at two widths reads their union), the same fold `execute()` and the chain apply; a row read over a CTE reference no longer carries the reference's internal symbol key.
