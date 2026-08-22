---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: the create/drop/neither-exists
guard every built-in `ObjectKind`'s own `diff` opened with (identical
across eight kind files, differing only in the literal `kind` value)
is now one shared helper (`createOrDropDiff`, `packages/core/src/
kind/diff-helpers.ts`). Lowers cyclomatic complexity in `function-
kind.ts`'s and `enum-kind.ts`'s `diff` below the CRAP gate's reporting
threshold (#154); `table-kind.ts`'s `diff` will move to the same
helper in a follow-up once #193 lands (file overlap).
