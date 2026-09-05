---
"@hejbro/core": minor
---

Set-operation branches must agree in type family. A combinator (core's, the chain's) and a recursive CTE's anchor/recursive-term pair now fail to type-check when one projected key's two families are a pair Postgres refuses to unify, measured on postgres:17. A `sql` fragment or an unplaceable literal (family `"unknown"`) matches any family, and a divergence inside one family (`integer` against `bigint`) is invisible to the rule by construction.
