---
"@hejbro/core": patch
---

Fixes an adversarial-review defect cluster in `SelectNode` traversal
(#444): a literal inside `groupBy`/`having`/`distinct on` now becomes a
bind parameter instead of splicing into the SQL text; a foreign
reference in one of those clauses throws `foreign-column-ref` instead
of rendering wrong SQL; a rename now retargets those clauses in a
stored view's query, closing a no-leftover-diff gap; a pre-`groupBy` v8
snapshot decodes leniently instead of raw-`TypeError`ing; RLS
declaration-time scope checks and `@hejbro/supabase`'s
`rls-uncached-auth-call` validator now see `auth.uid()` inside those
clauses too. `min`/`max` keep their argument's read type but not its
`ColumnRef`-ness, so an aggregate stops type-checking where a
declaration API requires a real column reference — a compile-time
failure now, instead of a silent wrong value at apply time. A written
`null` reaches a `json`/`jsonb` column as SQL NULL, not the JSON
document `null`; the JSON document `null` stays reachable through the
`sql` escape hatch. An aggregate cell (`count()`/`min`/`max`) inside a
nested read now casts and revives losslessly past `2^53`, the same
guarantee a direct column already had.

This lands as `patch`, not `major`, even though the proposal calls the
`min`/`max` change breaking: it is a type *narrowing* on an unreleased
surface (code that compiled and failed wrong at apply time now fails to
compile, the fix), and the `json`/`jsonb` null semantics ride on
`write-json-and-bytea`, which has not shipped — no released contract
moves, and `major` is not used before 1.0.
