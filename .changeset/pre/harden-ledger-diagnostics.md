---
"hejbro": patch
---

Attribute every ledger failure to the ledger. A read or a write the database refuses on `"hejbro"."migration_ledger"` is now a coded diagnostic naming the ledger, the connected role and the server's own code and message, with a `Next:` line — never a raw driver object or a stack trace. A refused ledger write is never reported as the failure of the migration being applied, and the report states that the migration rolled back with it.

`@hejbro/pg`'s connection pool no longer crashes the process when a checked-out or idle client's own connection fails (e.g. a terminated backend) — the failure now reaches the caller as a normal rejection, which the coded diagnostic above renders instead of a raw, unhandled `'error'` event. `@hejbro/pg` attaches its client error listener once per client (no MaxListeners warning on long runs) and discards a client whose connection died, so the ledger diagnostic names the role after a terminated backend; a lost connection or cancelled statement is answered with a rerun, never a grant.
