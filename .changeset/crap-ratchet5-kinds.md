---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal readability refactor (#154 ratchet-5, no behavior change):
`kinds/policy-kind.ts`'s `emit` now uses the established `dispatchEmit`
handler-map pattern (`emitCreateChange`/`emitAlterChange`/`emitDropChange`)
instead of an inline `switch`; `kinds/table-kind.ts`'s `diff` splits its
four keyed-diff computation into `tableFieldDiffs`, and the emptiness/note
checks that use them into `isEmptyTableFieldDiffs`/`tableFieldDiffNotes`;
`kinds/table-kind-emit.ts`'s `sequenceForAddedColumn` splits its two
compound conditions into `isMatchingSequenceCreate`/`sequenceOwnsColumn`.
