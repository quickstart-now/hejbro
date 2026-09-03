---
"@hejbro/core": minor
---

Pre-0.2.0 hardening of the query surface (the `harden-query-surface`
change; the fixed group moves all six packages). A declared index's
`.on(...)` column must now belong to the table declaring the index —
a plain column reference resolved from another table's declaration
fails with `foreign-column-ref`, naming the foreign column, instead of
passing silently or misdiagnosing a same-named collision as unknown
(#464). Core's own `union()`/`unionAll()`/`intersect()`/`intersectAll()`/
`except()`/`exceptAll()` now type-check branch key-set compatibility
the same way the query package's chain surface and a recursive term
already did, refusing a mismatched key set at build time instead of
compiling a statement the server would reject (#487). Two branches — or
a recursive CTE's anchor and recursive term — whose projections list the
same key SET in a different ORDER are now refused at build time too,
naming both orders and the first disagreeing position: `keyof` has no
key order, so this half of #487 was previously silent data corruption
(the wrong column's values under the right column's name) rather than a
build error. `orderBy` (a select's own, a window's `over(...)` spec, and
a set operation's whole-set order) accepts `asc(column)`/`desc(column)`
with an optional `nulls: "first" | "last"` placement, the same vocabulary
a declared index's column order already used, closing the gap where a
query previously had no way to spell an explicit nulls placement at all
(#470); `OrderByTerm` gains an optional `nulls` field, additive-compact
and format-version-neutral. `countWhere(expr)` is removed rather than
renamed (#469): it read as a predicate filter but actually counted rows
where the operand was non-null, the one invented name among the
aggregate vocabulary, and a real `FILTER (WHERE ...)` construct is
tracked as a follow-up rather than shipped under that name — `count()`
now accepts an optional operand directly. The recursive-term compatibility
requirement's own justification is corrected (the shipped text
overclaimed both an aggregate and a window function are legal there;
measured, the aggregate half is refused by Postgres) and its documented
scope is narrowed with two measured divergences (#489, partially closed):
nullability alone diverging between anchor and recursive term is
deliberately still accepted, while a same-family declared-type divergence
(e.g. `numeric` against `bigint`) remains a known, tracked gap rather than
a claimed-closed one.
