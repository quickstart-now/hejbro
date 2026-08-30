---
"@hejbro/query": minor
---

`db(schema, driver, { context })` registers an execution-context
provider: a resolver consulted once per execution, applied through the
same `assertDeclaredRole`/`applyContext` mechanism `db.as(context)`
already used — every thenable chain member, `execute`, `db.fn.*`, and
`transaction(callback)` run under the resolved context automatically,
so a call site no longer has to remember to wrap itself. An explicit
`handle.as(context)` still always wins and never consults the
resolver; a resolver that throws propagates its exact error and opens
no transaction; a resolver that yields nothing (bypassing its
non-nullable return type) fails closed with `context-provider-empty`
before anything reaches the database. Registering a provider is an
observable change on a handle that previously ran unwrapped: that
execution now opens a wrapping transaction, though the statement's own
SQL and parameters are untouched. The handle's existing
`nested-transaction-unsupported` reentrant guard applies identically
whether or not a provider is registered. `@hejbro/supabase` needed no
new code for this: its existing `asUser`/`asAnon` context builders
already produce the values a provider's resolver returns.
