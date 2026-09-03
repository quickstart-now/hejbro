---
"@hejbro/core": minor
---

Nested transactions run on savepoints. The `tx` handle a transaction
callback receives now carries its own `transaction()`: it brackets the
nested callback with `SAVEPOINT` / `RELEASE SAVEPOINT`, rolls back to the
savepoint on a throw and rethrows the error unchanged, all on the same
connection. A rolled-back nested transaction leaves the enclosing one
usable, so the outer callback can catch and carry on. Calling
`transaction()` on the db handle from inside a callback still fails —
that would take a second connection out of the pool — and its message now
points at `tx.transaction(...)` (#313).
