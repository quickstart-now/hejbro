# @hejbro/neon

The [Neon](https://neon.tech/) provider preset for hejbro's query layer
(`@hejbro/query`): roles, auth expression helpers, and context builders
for Neon's Data API, plus `neonDriver` — a driver overloaded on the
`@neondatabase/serverless` client it is handed, so a Neon `Pool`
(WebSocket, real interactive transactions) and a `neon()` query function
(HTTP one-shot) each declare their own true capability set.

`@neondatabase/serverless` is a peer dependency: install it alongside
this package. See `/docs/specs/2026-08-19-hejbro-design.md` for the full
design. No public API docs yet — read the JSDoc on each export in
`src/index.ts` in the meantime.
