---
"@hejbro/core": patch
---

A view created after a schema-wide table grant (`grant(schema).tables(...)`) now has that grant re-issued right after `create view`, exactly as a table does (#121/D78): Postgres's `grant ... on all tables in schema` covers views too, so a migration chain that skipped it left the view ungranted where a fresh migration granted it (#742).
