---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`@hejbro/supabase` adds `authUidCached()`/`authJwtCached()` (#97) --
the initPlan-cached form of `authUid()`/`authJwt()`, for use in RLS
`using`/`withCheck` clauses (they render `(select auth.uid())`/
`(select auth.jwt())`, which Postgres evaluates once per statement
instead of once per row). `authUid()`/`authJwt()` are unchanged and
remain the correct form inside a column `default`/`check` expression,
where a scalar subquery is illegal.

A new validator, `rls-uncached-auth-call` (part of
`supabaseValidators`), warns when a policy calls the plain form where
the cached one belongs. It does not look at column `default`/`check`
expressions at all.
