---
"@hejbro/core": patch
---

Refuse an empty on-conflict target: `onConflictDoNothing()` with no
columns (or `onConflictDoUpdate` with an empty `target`) now fails fast
with `empty-conflict-target` instead of rendering `on conflict ()` —
SQL Postgres rejects at parse time.
