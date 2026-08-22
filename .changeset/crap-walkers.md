---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores further (#154
PR3, following PR2's #210). `renderTypeNode`'s 28-case `switch` over
`TypeNode`'s `typeName` is now a type-closed handler map, same technique
as PR2's `ExprNode` walkers. `view-kind.ts`, `function-kind.ts`,
`enum-kind.ts`, and `table-kind-emit.ts`'s own `emit` — a
`switch (change.operation) { "create" | "alter" | "drop" }` each opened
with, deliberately left untouched by PR2 — now share one dispatch helper
(`kind/emit-helpers.ts`'s `dispatchEmit`), with each operation's own body
extracted into its own named function per kind.
