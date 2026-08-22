---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores across
several core walkers and kind-diff functions (#154). The create/drop/
neither-exists guard every built-in `ObjectKind`'s own `diff` opened
with (identical across all eight kind files that use it, differing
only in the literal `kind` value, including `table-kind.ts`) is now
one shared helper (`createOrDropDiff`, `packages/core/src/kind/
diff-helpers.ts`). A new `familyOfTypeNode` lookup table replaces a
type-family switch. `plpgsql`'s recording context now carries its
state explicitly instead of through nested closures. Five other
tree-walker switches (rename-retarget, the expression renderer,
`codec.ts`'s encode/decode, a column-scope walker, and a general tree
walker) are now type-closed handler maps instead of `switch`
statements.
