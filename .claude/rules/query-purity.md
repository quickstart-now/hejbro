---
paths:
  - "packages/query/**"
---

# Query-layer purity

`@hejbro/query` is pure over core's DSL: it compiles statements, defines
the driver contract, and converts result values. It never performs I/O of
its own — no sockets, no filesystem, no timers. Every side effect happens
inside a `Driver` implementation living in `@hejbro/pg` or a provider
preset.

- A change that seems to need I/O here belongs in a driver package — stop
  and reconsider before adding it.
- The compiler stays deterministic: same statement, same SQL text and
  parameter order, no environment reads.
- Error sites use the enriched plain-`Error` idiom with a literal string
  `code` and a `Next:` clause — the diagnostic gates scan this package
  (derived roots, #372), so a variable-routed code or a missing marker is
  a gate failure, not a convention.
