---
"hejbro": minor
---

A vendored contract (`hejbro vendor`) now carries every `defineFunction`
declaration the schema repository exports, not just its tables. The
generated `createDb(conn)` client gains a typed `fn` member — `db.fn
.searchByStatus({ status: "published" })` — calling a vendored function
exactly like `db.fn` already does for a local `db()` handle built from
declarations in the same repository, including through `db.as(context)
.fn` for a role-scoped call. `Functions` is keyed by each function's own
export name from the schema module (`Tables` stays keyed by SQL name,
matching `db()`'s own table keying) — the two groups use different rules
on purpose, since a function's export name and a table's SQL name are
independently-sourced namespaces that can collide without either one
disappearing from the generated client.
