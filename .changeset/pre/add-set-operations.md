---
"@hejbro/core": minor
---

Set operations land on the query surface: `.union()`, `.unionAll()`, `.intersect()`, `.intersectAll()`, `.except()`, and `.exceptAll()` combine selects (nesting composes) into one statement with whole-set `orderBy`/`limit` (rendered as output column names — Postgres's own set-op rule), fully visible through `compile()`. Branch row compatibility is enforced at the type level (mismatched keys fail to compile); results type as the left branch's keys with per-column unions and OR'd nullability, and rows convert per the left branch's declarations. A set-operation query is a valid view body: it round-trips structurally through the snapshot (no format-version change) and the view's columns resolve from the left branch.
