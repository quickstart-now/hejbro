---
"@hejbro/query": minor
---

Pre-0.2.0 hardening of the query layer (the `harden-query-layer`
change; the fixed group moves all five packages, and this one
changeset covers the change's three landing PRs). Array columns of
moded `bigint`/`numeric` and `interval` now convert element-wise to
their declared read types, with `interval[]` and `numeric[]` arriving
as raw Postgres array text through `@hejbro/pg`'s per-query override
(`numeric[]` previously lost precision silently under pg's default
float parse). Mutation builders accept the declared read types
(mode-resolved `bigint`/`number`/`string`, structured `IntervalValue`,
element-typed arrays) and lift them to canonical text bind parameters.
`@hejbro/pg`'s checkout pin calls the driver value's own
`setupSession` member, so decorator-wrapped hooks take effect.
`Tx.execute` resolves `ExecuteResult` statement types like
`db.execute`. Default numeric modes are structurally derived from a
single constants module, and reading a negative interval no longer
produces `-0` axis fields.
