# @hejbro/neon

The [Neon](https://neon.tech/) provider preset for hejbro's query layer
(`@hejbro/query`): `authenticatedRole`/`anonymousRole`, `authUid()`/
`authJwt()` over `pg_session_jwt`'s identity functions, `neonAuth(mode)`
— an auth-surface factory that fixes `pg_session_jwt`'s authentication
mode (`"claims"` or `"jwt"`) once and returns only that mode's context
builders (`asUser`/`asJwtUser`/`asAnonymous`, plus the `NeonAuthMode` and
`Claims` types) — and `neonDriver`, overloaded on the
`@neondatabase/serverless` client it is handed, so a Neon `Pool`
(WebSocket, real interactive transactions) and a `neon()` query function
(HTTP one-shot) each declare their own true capability set.

`@neondatabase/serverless` is a peer dependency: install it alongside
this package. See `/docs/specs/2026-08-19-hejbro-design.md` for the full
design and `skills/hejbro/references/neon-preset.md` for the usage guide
(connection paths, authentication modes, and the failure modes each one
produces). No public API docs beyond that yet — read the JSDoc on each
export in `src/index.ts` in the meantime.
