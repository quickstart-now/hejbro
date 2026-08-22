---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

A policy `using`/`withCheck` expression that references a table outside
its own schema/table — including one buried inside a correlated
`exists()` subquery, referencing neither the subquery's own `from`/joins
nor the outer policy's table — is now rejected at **declaration time**
(`rls-policy-foreign-column`), the same moment every other policy
validation runs. Previously this specific shape (a foreign reference
*inside* `exists()`) only surfaced later, at `hejbro generate` time
(`foreign-column-ref`), as a side effect of rendering the policy's SQL
(#160).

Fixing this closed a gap, not a new rule: a *direct* out-of-table
reference (not inside `exists()`) was already rejected at declaration
time before this change. If your declarations pass today, this changes
nothing for you — a policy an earlier `hejbro generate` already accepted
was already valid under the old, narrower check too.
