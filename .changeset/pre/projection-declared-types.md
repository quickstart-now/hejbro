---
"@hejbro/core": minor
---

Object projections keep their declared column types. `select({ total:
posts.amount }, posts)` reads `total` as `bigint` rather than the
family-wide `number | bigint | string`, a projected
`jsonb().$type<T>()` column as `T` rather than `unknown`, and an array
column as its declared element array — recovered from the column
reference's own declaration link, so `returning({...})` improves with it.
Fields still type as nullable: a left join can null any of them (#307).
