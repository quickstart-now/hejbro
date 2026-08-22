---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores ahead of the
`CRAP_THRESHOLD = 5` ratchet (#154), closing out the `engine` +
`kind/diff-helpers.ts` slice #249 started. `generateMigration`
(`engine/generate.ts`, complexity 10 — the widest single split in this
slice) splits into `resolveGenerateMigrationOptions`/`blockedResult`/
`sortPredropStatements`, each answering one question the original
function's own branches asked inline. Two functions that surfaced
after #249 opened also clear: `validateRequiredKeys`
(`snapshot/snapshot.ts`) splits out its own gap-detection question into
`requiredKeyGapFor`; `findExprScopeViolation`'s `sqlTemplate` handler
(`expr/walk.ts`) moves from an inline `if` inside a `.flatMap()`
callback to a `.filter().map()` chain (previously untested — added a
test using a `sql\`\`` template with an embedded foreign-column
reference). `engine/duplicate-version-fix.ts`'s `orderGroupByChain`
also gains a one-line comment naming why its root-count check exists,
even though (like the `hasFork` check #249 already removed) it's
subsumed by `walkGroup`'s own failure mode for the same inputs.
