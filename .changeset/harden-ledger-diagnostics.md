---
"hejbro": patch
---

Attribute every ledger failure to the ledger. A read or a write the database refuses on `"hejbro"."migration_ledger"` is now a coded diagnostic naming the ledger, the connected role and the server's own code and message, with a `Next:` line — never a raw driver object or a stack trace. A refused ledger write is never reported as the failure of the migration being applied, and the report states that the migration rolled back with it.
