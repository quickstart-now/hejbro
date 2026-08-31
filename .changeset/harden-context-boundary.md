---
"@hejbro/query": minor
---

A `contextRequired` driver now refuses an execution whose context
rendering — its own contribution, or the default rendering — produces
zero statements, with `context-rendering-empty`: the requirement is
that an execution *applies* a context, not merely that it names one.
The refusal fires after the rendering has run and before any
caller-supplied statement is sent, inside the transaction the query
layer already opened, and is drawn from the number of statements
returned alone, never from reading or rewriting them. This closes a gap
`db.as({})` and a driver's own empty-rendering contribution previously
passed through silently.

The `operation` a refusal names — `context-required`,
`context-rendering-empty`, and `driver-missing-capability` alike — is
now the caller's own surface (`db.execute`, `db.select`, `db.insert`,
`db.update`, `db.deleteFrom`, `db.with`, `db.fn`), on the explicitly
scoped path and the provider path alike, replacing the shared
`"db.as"`/`"db.context"` placeholders those errors previously carried.
`transaction` is the one exception, unchanged on purpose: the driver
contract requires a driver's own thrower to raise the identical token
for its own member.
