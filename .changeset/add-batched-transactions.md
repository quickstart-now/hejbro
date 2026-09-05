---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
"@hejbro/query": minor
"@hejbro/pg": minor
"@hejbro/neon": minor
"@hejbro/nile": minor
---

The driver capability set gains a fourth key, `batched-transactions`: a
driver that declares it can run a pre-assembled list of statements as
one transaction, in one round trip where possible, returning one row
list per member. Every `Driver` now implements a mandatory `batch`
member — a driver declaring the capability `false` still implements it,
by refusing before sending anything, the same pattern `transaction`
already uses on a non-interactive driver.

`db.as(context)` picks a driver's declared capability to decide how it
runs: `interactive-transactions` still wins where declared, otherwise a
driver declaring `batched-transactions` runs the context and the
caller's own statement as one batch. This makes `@hejbro/neon`'s HTTP
path (`neonDriver(sql)`, built from a `neon()` query function) usable
with `db.as(context)` for the first time — role and settings apply
transaction-local to that one batch. `db.transaction(callback)` is
unaffected and still requires `interactive-transactions`, since a
callback is interactive by definition.

A batch failure is reported as a batch: every member statement, in
order, with a statement that the driver does not report which member
failed — never naming only the caller's own statement, which may not
have been the actual cause. A driver whose `batch` resolves the wrong
number of row lists (fewer, more, or none) is refused with the new
`batch-result-count-mismatch`, naming both counts, rather than silently
handing a context statement's own rows back as the caller's.

A multi-command `sql`-kind text (`select 1; select 2`, only reachable
through the `sql` escape hatch) now resolves to the **last** command's
rows — psql's own convention — instead of `undefined` or a crash.
`@hejbro/pg` and `@hejbro/neon`'s own session-setup statement is itself
multi-command, so this rule is exercised on every connection. `@hejbro/
query` exports this fold itself as `lastRows(result)`. It also newly
exports `preparedStatementName(sql)` — the prepared-statement naming
rule `@hejbro/pg` and `@hejbro/neon` both call, so neither driver holds
its own copy of it anymore.
