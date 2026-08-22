---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores ahead of the
`CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242's slice
split with the `engine` + `kind/diff-helpers.ts` slice. Twelve
functions the ratchet-5 measurement found over the new threshold —
`validateConfirmDropTarget`/`rewriteSequencesForRename`/
`validateTableRenameTarget`/`validateColumnRenameTarget`/
`residualTableAmbiguities`/`retargetTableFields`
(`engine/rename-plan.ts`), `createOrDropDiff`
(`kind/diff-helpers.ts`, shared by all 8 built-in kinds),
`notNullWithoutDefaultWarnings` (`engine/core-validators.ts`),
`resolveDeclarations` (`engine/generate.ts`), and
`orderGroupByChain`/`parseVersionAsInstant`/`planDuplicateVersionFix`
(`engine/duplicate-version-fix.ts`) — are now split into named helpers
that each answer one question the original function's own branches
asked inline, the same de-nesting/extraction technique #154 PR2 and
#241/#242 already used. `orderGroupByChain` also drops a `hasFork`
pre-check found to be fully redundant with checks already below it.
Several needed test coverage only, no code change (a `--confirm-drop
target: "table"` spec, the `"unix"` migration-prefix strategy, a
single-member duplicate-version group).
