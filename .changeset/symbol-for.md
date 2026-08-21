---
"@hejbro/core": minor
---

`Table`'s and a trigger's `new`/`old` row's hidden metadata keys
(`tableMeta`, `triggerRowMeta`) now use `Symbol.for` instead of
`Symbol()`. Two installed copies of `@hejbro/core` (a real, if rare,
package-manager outcome — e.g. a version-conflict-driven nested
install) used to mint two different symbols sharing the same
description, so `isTable`/`getTableMeta` — and, downstream, a foreign
key's `references.table` cross-check (the shape `@hejbro/supabase`'s
`authUsers` is used in) — could silently disagree about a table's
identity across that boundary, up to and including a raw `TypeError`
instead of a diagnostic. `Symbol.for`'s global registry makes the
identity survive being installed twice.
