---
"@hejbro/query": minor
---

A driver can now own how an execution context becomes statements: an
optional `renderContext` on the driver contract turns a `DbContext`
into an ordered list of compiled statements, replacing the query
layer's own default (`set local role`, then one
`select set_config($1, $2, true)` per setting) when a platform's own
mechanism differs. `@hejbro/pg`, `@hejbro/supabase`, and `@hejbro/neon`
contribute no rendering and keep today's exact statement sequence,
pinned as regression tests. `DbContext.role` is now optional: a
context naming none is admitted only on a driver that declares its
platform role-less (`Driver.roleLessPlatform`) — a named role is still
validated against the declared whitelist on every driver regardless. A
driver can also declare a context mandatory (`Driver.contextRequired`):
every execution surface (`select`/`insert`/`update`/`deleteFrom`/
`with`/`fn`/`execute`/`transaction`) is then refused with
`context-required` before anything reaches the database when no
context was resolved; `handle.driver` (the schema-assertion path)
stays uncontexted, unaffected. The capability gate is unchanged: a
context still requires `interactive-transactions`, checked before any
rendering or resolver runs.
