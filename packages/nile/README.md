# @hejbro/nile

The [Nile](https://www.thenile.dev/) provider preset for hejbro's query
layer (`@hejbro/query`): a tenant context builder and `nileDriver`, a
decorator over a driver the caller already built (Nile speaks plain
Postgres on one connection path, so there is nothing else to model). The
package declares no runtime dependency on any Nile client — decorate
`@hejbro/pg`'s `pgDriver(pool)` (or another base driver that pins its
session at connection checkout) and pass the result to `db()`.

See `/docs/specs/2026-08-19-hejbro-design.md` for the full design and
`skills/hejbro/references/nile-preset.md` for the usage guide (the
tenant/user context, the values the preset refuses and why, and the base
driver shapes this decorator does and does not support). No public API
docs beyond that yet — read the JSDoc on each export in `src/index.ts`
in the meantime.
