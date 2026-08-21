---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`rls.policy(...).using(...)`/`.withCheck(...)` now accept
`Expr<"boolean"> | Expr<"unknown">` — the same union `check()` (D50) and
partial-index `.where()` (D51) already adopted, so a raw `sql` template
(e.g. `` sql`${t.status} <> 'done'` ``) can be used directly as a policy
predicate. Adds a `literal(value: boolean)` helper so an intentionally
permissive "allow every row" policy can be written as
`.using(literal(true))` instead of a borrowed-meaning workaround like
`isNotNull(someNotNullColumn)`.
