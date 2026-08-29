---
"@hejbro/neon": minor
---

Neon provider preset (#300): `neonDriver(pool)` decorates a
`@neondatabase/serverless` `Pool` (WebSocket, real interactive
transactions) and `neonDriver(sql)` decorates its `neon()` HTTP
one-shot function (declares both capabilities `false`, fails its own
`transaction()` closed rather than pretending to run one). Both paths
pin `intervalstyle`/`bytea_output` and force builtin oids 1186/1187/
1231 (`interval`, `interval[]`, `numeric[]`) to raw text so row shapes
match `@hejbro/pg`'s. `neonAuth("claims")` and `neonAuth("jwt")` each
return only that mode's context builders (`asUser`/`asAnonymous` vs
`asJwtUser`/`asAnonymous`) for the `pg_session_jwt` extension's two
identity sources, plus `authenticatedRole`/`anonymousRole` matching
Neon's own role names.
