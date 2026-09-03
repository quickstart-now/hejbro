# @hejbro/pg

Vanilla [node-postgres](https://node-postgres.com/) driver for hejbro's
query layer (`@hejbro/query`). Instance-based (`pgDriver(pool)`) or
connection-string (`pgDriver(connectionString)`) construction; pins
`IntervalStyle` to `'postgres'` per connection and delivers `interval`
columns as raw Postgres text via a per-query type override, so
`@hejbro/query`'s own conversion layer can parse them into a structured
`IntervalValue` — every other type keeps node-postgres's own defaults.

`pg` is a peer dependency: install it alongside this package.

See `/docs/specs/2026-08-19-hejbro-design.md` for the full design. No
public API docs yet — read the JSDoc on each export in `src/index.ts` in
the meantime.
