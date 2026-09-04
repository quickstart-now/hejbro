---
"@hejbro/core": patch
---

`defineFunction`'s reserved-name check now refuses the variables plpgsql
declares on its own, not only its keywords — `found`, `sqlstate`,
`sqlerrm`, and the twelve `tg_*` trigger variables, compared
case-insensitively the way an unquoted identifier folds — since a
declared argument or local under one of those names shadowed plpgsql's
own with no error at all, and the keywords Postgres reserves for
function and type names (`left`, `is`, `join`, `current_schema`, …)
(#748).

Two `defineFunction` argument keys that derive to the same SQL name
(`userId` beside `user_id`) are now refused at declaration time with
`duplicate-argument`, naming both keys and the shared name — the same
refusal a table's colliding column keys already get. Previously the
declaration succeeded and rendered a parameter list Postgres refuses at
`CREATE FUNCTION` (#751).

The same-kind dependency refinement inside `diffSnapshots` no longer
drops a kind's second change for one identity in one direction — two
creates, two alters, or two drops for a single object. No built-in kind
produces that shape, but a preset kind implementing
`ObjectKind.dependsOnIdentities` can, and the loss was silent: one fewer
statement in the generated migration, with no error (#774).
