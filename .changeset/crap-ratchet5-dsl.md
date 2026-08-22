---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal readability refactor (#154 ratchet-5, no behavior change):
`dsl/rls.ts`'s `assertClauseAllowed` and `dsl/table.ts`'s
`resolveReferenceTarget`/`validateIndexPredicates` each split their
independent rules/steps into their own named functions.
