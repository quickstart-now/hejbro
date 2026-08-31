---
"@hejbro/core": minor
---

Narrows left-join nullability (#307): an object-projection field and a
`returning()` field now follow their declared nullability instead of
always widening to `| null` — a projected `.notNull()` column types as
non-null unless its own table was actually left-joined in the same
statement, and `returning()` is always non-null-exact, since a mutation
has no join grammar to leave uncertain. This is a type-narrowing change
only: generated SQL, snapshots, and runtime behavior are unchanged, and
existing code that already widened its own annotations (or never
narrowed a field it could now narrow) keeps compiling — only code that
asserted a now-provably-non-null field was still `| null` can break.

Aggregates and window functions stay nullable regardless of any join
(an empty aggregate or a partition boundary can still produce `null`).
So do **object-projection** fields read in a position that cannot see
the surrounding statement's joins — inside a nested read, a CTE body, a
view body, or a hand-written `SelectResult`. Whole-table rows in those
same positions are untouched: a `jsonArrayFrom(select(table))` element
and a `related()` row carry declared nullability exactly as they always
have.
