---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`@hejbro/core` re-exports `decodeExprNode` from its public index, paired
with the already-public `renderExpr` — tooling outside the package can
now render a declared column's default expression back to SQL text the
same way core itself does, without reimplementing the expression codec.
No behavior change: this is purely a new public export exposing
existing, already-tested internal logic.

(This capability is exercised by `scripts/check-declared-vs-catalog.mjs`,
a private, non-published tool — #218 — which is why the fixed group's
other two packages carry no code changes of their own here beyond the
version bump their `.changeset/config.json` fixed grouping requires.)
