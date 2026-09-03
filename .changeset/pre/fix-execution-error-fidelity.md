---
"@hejbro/query": patch
---

query-execution-failed now leads with the driver's own message, ahead of the parameterized SQL — the reason survives truncation in default views; a non-error cause is named, never interpolated. The full driver error stays on `cause`.
