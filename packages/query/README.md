# @hejbro/query

Typed query layer for hejbro: a pure statement compiler over the schema
DSL, a driver contract, RLS execution context, and a `db()` handle whose
`select`/`insert`/`update`/`deleteFrom` chains are thenable — inert until
awaited, with a pure `.compile()` preview on every chain.

Drivers live in their own packages (`@hejbro/pg` for vanilla Postgres,
`@hejbro/supabase` for the Supabase preset). Most users reach this
package's surface through the `hejbro` facade rather than importing it
directly.

See `/docs/specs/2026-08-19-hejbro-design.md` for the full design. No
public API docs yet — read the JSDoc on each export in `src/index.ts` in
the meantime.
