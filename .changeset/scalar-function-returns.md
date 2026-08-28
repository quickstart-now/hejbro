---
"@hejbro/core": patch
---

Scalar-returning functions can be written, and the wrong return shape is
refused at declaration time. `ctx.return(expr)` renders `return <expr>;`
for a function declared with a scalar `returns` type; returning a query
from one now fails with `scalar-return-expects-expression` instead of
emitting `return query …`, which Postgres rejects at apply time. A scalar
body that never returns fails with `scalar-return-missing` (#424).
