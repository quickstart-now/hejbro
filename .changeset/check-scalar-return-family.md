---
"@hejbro/core": patch
---

Refuse a scalar `ctx.return(<expr>)` whose type family can never convert to the declared `returns` family, at declaration time, with `scalar-return-family-mismatch`. The refusal table holds only pairs measured on Postgres 17 as failing for every value — a pair Postgres accepts for some values stays accepted, a `sql` fragment is never family-checked, and text/bytea returns accept every family.
