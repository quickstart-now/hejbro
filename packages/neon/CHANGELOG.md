# @hejbro/neon

## 0.2.0-pre.0

### Minor Changes

- 7aa7ffa: Neon provider preset (#300): `neonDriver(pool)` decorates a
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

### Patch Changes

- Updated dependencies [6b3cc7f]
- Updated dependencies [5aebe5c]
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
- Updated dependencies [65936ca]
- Updated dependencies [9963d04]
- Updated dependencies [9f58667]
- Updated dependencies [e530909]
- Updated dependencies [27d5554]
- Updated dependencies [31c7ffd]
- Updated dependencies [5f8b97f]
- Updated dependencies [46b902c]
- Updated dependencies [28aec17]
- Updated dependencies [effda0a]
- Updated dependencies [1f459d1]
- Updated dependencies [e6c802c]
- Updated dependencies [2146480]
- Updated dependencies [f2e7781]
- Updated dependencies [70e68cc]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [387a2cc]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [dafb897]
- Updated dependencies [ef00b1b]
- Updated dependencies [0f19390]
- Updated dependencies [1aa05f2]
- Updated dependencies [71033ca]
- Updated dependencies [7bbdc8b]
- Updated dependencies [6345323]
- Updated dependencies [232293e]
- Updated dependencies [43bbebd]
- Updated dependencies [67ebf69]
- Updated dependencies [4be9551]
- Updated dependencies [d3c39bc]
- Updated dependencies [7c472b7]
- Updated dependencies [221d650]
- Updated dependencies [9394b37]
- Updated dependencies [b2be9b9]
- Updated dependencies [34afb30]
  - @hejbro/core@0.2.0-pre.0
  - @hejbro/query@0.2.0-pre.0
