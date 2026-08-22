---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`hejbro` now keeps a schema-wide `grant(schema).tables(...)` (one-shot
`all-tables-privileges`) in step with tables added by a later migration
(#121). Postgres's own `grant ... on all tables in schema ...` only ever
covers the tables that exist when it runs — a table declared after that
grant already existed silently ended up ungranted, a chain-vs-fresh
asymmetry the local round-trip caught but golden tests can't (they never
run real SQL). `hejbro generate` now re-issues the exact schema-wide
statement right after `create table` for every standing
`all-tables-privileges` grant already covering the new table's schema.

Extension interface change (D78): `ObjectKind.emit` gains a third,
optional, read-only parameter — the full snapshot the diff is generating
*toward*. `siblingChanges` (D74) can't cover this case: it's the diff's
own change list, and a standing grant unaffected by the new table never
appears there. Additive and backward compatible — every existing `emit`
implementation (10 across `@hejbro/core` and `@hejbro/supabase`) ignores
it and needs no change; only `tableKind`'s `create` case reads it.
