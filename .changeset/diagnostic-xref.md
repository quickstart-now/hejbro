---
"@hejbro/core": patch
---

Internal: replaced ternary expressions with if/early-return helpers
across `@hejbro/core` and `hejbro` (no behavior change), and added a
CI check that cross-referenced diagnostic error codes actually exist.
