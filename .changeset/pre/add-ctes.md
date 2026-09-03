---
"@hejbro/core": minor
---

Common table expressions: `withCte((w) => { ... })` (and `handle.with(...)`
on a `db()` handle, the same callback) declares a `WITH` statement.
`w.as(name, query, options?)` declares an entry and hands back a typed
reference usable as a `from` source anywhere a table would go (never as a
join target); an entry may reference an earlier entry, never a later one
or itself. `w.asRecursive(name, anchor, (self) => recursiveTerm, options?)`
declares a recursive entry — the anchor fixes the CTE's own row type
(Postgres's own rule), and the recursive term is checked for
union-compatibility with the anchor (the same rule `.union()` already
applies between two branches: matching keys required, each key free to be
computed differently on either side, e.g. a window function). The
recursive branch's own combinator surface is narrowed to `union`/
`unionAll` only, so the four measured postgres:17 rejections (whole-set
`order by`/`limit`/`offset`, `intersect`/`except` as the combinator) are
unrepresentable rather than merely guarded. `options?.materialized` is a
tri-state hint rendering `MATERIALIZED`/`NOT MATERIALIZED`/neither, on
either kind of entry. Views, column ordering, the rename engine, and the
Supabase RLS validator all widen to see through a `WITH` wrapper to its
real tables.
