---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores ahead of the
`CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242/#249/#253's
slice split with the `packages/core/src/kinds` slice (①-B). Five
built-in kinds' `emit` the ratchet-5 measurement found over the new
threshold — `rls-kind`, `sequence-kind`, `schema-kind`, `grant-kind`,
`trigger-kind` — each move their `"create"`/`"alter"`/`"drop"` switch
case into its own named module-scope handler, dispatched through a
mapped `EmitHandlers` type over `ChangeOperation` (the object-literal
handler-map technique #154 PR2/#241 already used) so a missing case is
a compile error instead of a `switch`'s `default: assertNever(...)` at
runtime — each handler is then scored as its own independent function.
`sequence-kind`'s `diff` is also converted to reuse the shared
`createOrDropDiff` guard, matching the other built-in kinds that
already use it. No array-of-predicates tricks; every extraction is
covered by a red-first mutation (swapped/inverted dispatch, confirmed
to fail the existing golden tests) proving it's genuinely load-bearing.
