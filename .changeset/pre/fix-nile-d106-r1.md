---
"hejbro": patch
---

`check` under a preset that declares no planning (`explainUnavailable`) no longer normalizes the inside of a string literal — a quoted word or a qualifier-like name inside a literal is content and a difference it carries is reported as not compared; a reserved keyword stays quoted under the identifier-unquoting step; and a failed catalog read in that mode gets a `Next:` that names the catalog read instead of `EXPLAIN` (naming `pg_get_expr`, the read that fails). The cast-stripping step now strips the whole cast the server appends to a string literal — `text[]`, `character varying(20)`, `timestamp with time zone`, a schema-qualified or quoted type name — not only a single-word type name.
