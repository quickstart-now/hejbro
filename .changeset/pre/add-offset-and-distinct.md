---
"@hejbro/core": minor
---

Selects paginate and de-duplicate. `.offset(n)` chains after `limit` (or
stands alone), `.distinct()` collapses duplicate rows, and
`.distinctOn(...columns)` takes one row per group — the row the
statement's `order by` puts first, Postgres's own semantics, first-class
rather than pushed to the `sql` escape hatch. Row counts render inline,
never as bind parameters, the rule `limit` already followed.

**Snapshot format moves to 8**: a view body's select now records its
`offset` and `distinct`, so an older build refuses a version-8 snapshot
loudly instead of diffing a paginated view as if it had neither (#437).
