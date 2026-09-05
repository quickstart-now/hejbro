---
"@hejbro/core": minor
---

Export the expression traversal (`exprChildren`, `replaceExprChildren`)
and the kind-change guards (`requireNext`, `requirePrevious`,
`requireBoth`) as extension surface, so a preset or sibling package walks
and rebuilds expressions, and reads a change's sides, through core
instead of restating them.

The storage-bucket kind that folded onto the guards now names the change
by its kind token when it refuses: `supabase-storage-bucket …` instead
of its former display label. The refusal code is unchanged
(`invalid-kind-change`).
