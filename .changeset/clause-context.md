---
"@hejbro/core": minor
"@hejbro/supabase": minor
---

`@hejbro/core` exports `someDeepExprNode`, a deep expression walker that
descends into `exists(...)` subqueries (#141). `@hejbro/supabase` adds
the `cached-auth-call-outside-rls` validator, built on it: it errors
when a column `default`, a CHECK, or a partial-index predicate calls
`authUidCached()`/`authJwtCached()` — both render a scalar subquery,
which Postgres forbids outside RLS.
