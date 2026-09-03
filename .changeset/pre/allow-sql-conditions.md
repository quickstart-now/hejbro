---
"@hejbro/core": patch
---

`sql` fragments are accepted in every condition position. Select `where`,
join `on`, update and delete `where`, `related()`'s `where`, and the
`and`/`or`/`not` combinators now take the same
`Expr<"boolean"> | Expr<"unknown">` union — exported as `Condition` —
that `check()`, partial indexes and RLS policies have always taken, so a
predicate the typed operators cannot express needs no cast to reach a
query (#386).
