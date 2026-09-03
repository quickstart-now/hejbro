---
paths:
  - "packages/pg/**"
---

# pg driver boundary

`@hejbro/pg` wraps node-postgres behind `@hejbro/query`'s driver
contract. It owns exactly the side effects: connections, sessions, type
parsers, the IntervalStyle pin.

- No compilation or conversion logic here — that is `@hejbro/query`'s;
  this package only transports compiled statements and raw rows.
- Type-parser overrides are per-query (`types` on the query config),
  never global (`pg.types.setTypeParser` mutates the process — forbidden).
- The integration suite is Docker-gated and local-only; unit tests never
  require a server.
