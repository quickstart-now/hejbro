---
"@hejbro/core": minor
---

Export the expression traversal (`exprChildren`, `replaceExprChildren`)
and the kind-change guards (`requireNext`, `requirePrevious`,
`requireBoth`) as extension surface, so a preset or sibling package walks
and rebuilds expressions, and reads a change's sides, through core
instead of restating them.

The two preset kinds that folded onto the guards now name the change by
its kind token when they refuse: `supabase-storage-bucket …` and
`smoke-schema-note …` instead of their former display labels. The
refusal code is unchanged (`invalid-kind-change`).
