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

**No format-version bump** (this wave's version already opened the
door for this in `phase8-snapshot-v5`), but this is a breaking shape
change with no compatibility shim: a committed snapshot written before
this change, containing any of these four fields, will fail with
`error[malformed-snapshot-node]` when read by `hejbro generate` —
confirmed by reading a real snapshot from immediately before this
change. hejbro makes no snapshot-compatibility promise before 1.0
(pre-publication, no migration path — see AGENTS.md/D65); this is the
kind of churn that policy exists to allow while it's still free.
