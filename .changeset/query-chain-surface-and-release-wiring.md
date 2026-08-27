---
"@hejbro/query": minor
---

Thenable db-first chain surface, real packaging, and the `hejbro` facade
(#293 group 7): `db.select(...)`/`db.insert(...)`/`db.update(...)`/
`db.deleteFrom(...)` mirror core's own builder stages and delegate to
them directly (no second statement vocabulary) — a chain is inert until
awaited (no driver call happens while it's being built), and
`.compile()` on any stage is a pure, byte-identical preview of
`compile()`, never touching the driver. The chain surface is identical
across the unscoped `db()` handle, a `db.as(context)` scoped handle, and
`tx` inside `transaction()`, via one shared factory. `@hejbro/query` and
`@hejbro/pg` are now real published packages (tsdown build, `dist`
exports, LICENSE, README) rather than source-pointing internals, and the
`hejbro` facade re-exports `db`, the chain types, and `@hejbro/query`'s
dual-use `sql` (replacing the plain core `sql` re-export — one `sql`,
still compatible with every existing fragment use).
