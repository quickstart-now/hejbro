---
"@hejbro/core": patch
---

A snapshot's set-shaped arrays — `policy.roles`, `trigger.events` (fixed
rank insert, update, delete), `trigger.events[].columns`, `table.indexes`,
`table.checks` — now compare and record in a canonical order, not
declaration order, through a new optional `ObjectKind.canonicalize`
member. `diffSnapshots`, `generate`'s "did the snapshot move" check, and
`verify`'s check 2 (declarations against the file) all read through the
canonical form, so reordering one of these arrays in a declaration is no
longer a spurious diff, migration, or `verify` failure — only a hand edit
still trips `verify`'s tip-hash check (#701).

A vendored contract's client metadata now carries each table's columns
as a physical-order list instead of a plain object, so consumers
(`@hejbro/query`'s `synthesize.ts`) no longer read column order through
JavaScript's own key enumeration, which reorders integer-like keys ahead
of every other key regardless of insertion order. A contract vendored
before this change, whose metadata still carries the object-keyed shape,
keeps type-checking and reading correctly (#740).

Under `returns setof <table>`, `ctx.return()` inside a `defineFunction`
body now accepts only that table's whole row — a `select(<table>)` or a
mutation on it ending in a bare `.returning()` — and refuses every
projection, including one naming every column in a different order, with
the new error code `return-expects-whole-row`. Postgres's `return query`
matches result columns by position, never by name, so a complete but
reordered projection previously compiled and shipped a function whose
every call failed at runtime with "structure of query does not match
function result type" (#749).
