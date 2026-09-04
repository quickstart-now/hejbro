---
"@hejbro/query": patch
---

The scoped name-keyed handle (`createDb(conn).as(context)`) now refuses
a lookup of a name the contract doesn't vendor with `unknown-contract-table`,
exactly like the unscoped client already did — including `as` itself,
looked up on the scoped handle, which never resolved to it silently
before.

A statement (or a nested transaction) issued beside an in-flight nested
transaction on the same `tx` — or from any `tx` above it — is now
refused with `statement-during-nested-transaction` before it is ever
sent, instead of landing inside a savepoint bracket it never chose and
silently rolling back with it. A nested `tx` kept past its own
callback's return is refused the same way, under `statement-after-nested-transaction`,
naming the enclosing `tx` as where the statement belongs. The `tx` a
top-level `transaction()` callback itself received is refused the same
way once that transaction has committed or rolled back — under
`statement-after-transaction` — instead of quietly running its next
statement on whatever connection the pool hands out next, outside any
transaction.

The repo-internal driver-conformance kit now classifies a transaction-control
statement by the word it leads with once a semicolon glued to that word
is stripped too, matching the driver-contract requirement's own wording
exactly — including a savepoint rollback's optional `work`/`transaction`
word, which now keeps the statement ordinary rather than ending the
transaction. A comment glued to a control word (`commit-- x`) no longer hides it from the conformance kit, and a nested transaction the callback never awaited keeps the starting `tx` refused only while it is in flight — its settling restores the starting `tx`, never a stale one.
