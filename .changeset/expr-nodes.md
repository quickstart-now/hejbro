---
"@hejbro/core": minor
---

Column defaults, CHECK expressions, partial index `where` predicates,
and policy `using`/`withCheck` clauses are now stored in the snapshot
as structured expression nodes (D67/D70) instead of pre-rendered SQL
text. This is what lets a table or column rename retarget the
identifiers inside these expressions exactly — including across
tables, when a policy reaches another table through `exists()` —
instead of leaving stale text behind. Rendered SQL output is
unaffected: the same `renderExpr` produces the same text at emit
time, now from a decoded node instead of a stored string.

**No format-version bump.** `v5` was opened by #152 for this change
(D68); a snapshot generated in the intermediate `dev` state between
#152 and #153 is not supported — no published version ever produced
such a snapshot. A committed snapshot containing any of these four
fields as pre-rendered SQL text (the only shape any published version
of `v5`, or any earlier format version, ever wrote) will fail with
`error[malformed-snapshot-node]` when read by `hejbro generate` —
confirmed by reading a real snapshot from immediately before this
change. hejbro makes no snapshot-compatibility promise before 1.0
(pre-publication, no migration path — see AGENTS.md/D65); this is the
kind of churn that policy exists to allow while it's still free.
