---
"@hejbro/core": minor
---

Query-vocabulary gaps for the query layer (#293): `leftJoin()` on the
select builder (new `joinKind: "left"` — snapshot codec accepts it, the
renderer emits `left join`) and `returning({ alias: expr })` object
projections on insert/update/delete (no-arg `returning()` keeps the
every-column explicit list; an empty projection throws
`empty-returning`).
