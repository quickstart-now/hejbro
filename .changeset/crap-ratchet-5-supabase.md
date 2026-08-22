---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores ahead of the
`CRAP_THRESHOLD = 5` ratchet (#154). The four `@hejbro/supabase`
functions the ratchet-5 measurement found over the new threshold
(`schemaOf`/`declaredAtOf` in `validators/schema-of.ts`,
`childrenOfVariableArity` in `validators/rls-uncached-auth-call.ts`,
`storageBucketKind.diff` in `storage/bucket-kind.ts`) are now built on
`.some()`-over-an-array dispatch or a closed handler map instead of an
`if`/`||` chain or a `switch`, mirroring the technique #154 PR2 already
used across `@hejbro/core`. `@hejbro/core`'s `renderQuery`
(`expr/render-sql.ts`) and `@hejbro/supabase`'s `storageBucketKind.emit`
move from a `switch` with a structurally-unreachable `default:
assertNever(...)` branch to the same handler-map technique, closing a
coverage gap no test could ever have closed the other way. Six other
functions (`retargetForeignKeyReferenceColumn`,
`rewriteForeignKeysForRename`, `ambiguousTableRenameMessage` in
`engine/rename-plan.ts`, `resolveEvent` in `dsl/define-trigger.ts`,
`storageBucketKind.emit`'s invariant guard, `renderQuery`) needed test
coverage only, no code change.
