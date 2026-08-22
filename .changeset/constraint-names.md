---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`hejbro` now records a table's primary key constraint name
(`TableSnapshot.primaryKeyName`) and every unique column's constraint
name (`ColumnSnapshot.uniqueName`) in the snapshot, matching Postgres's
own naming convention exactly (`<table>_pkey`, `<table>_<column>_key`)
— frozen now, pre-1.0, so a later feature never has to disagree with a
name already committed to a user's database (#24/D68).

`generateMigration` diffs a primary key as one table-level constraint
(the set of `.primaryKey()` columns), replacing #137's silent gaps —
adding a primary-key column to an existing table, and a composite
primary key's partial drop — with real `add constraint`/`drop
constraint ... primary key` emission. A column's own `.primaryKey()`
flag flipping in place is folded into the same rule.

`hejbro verify`/rename plans keep both names in step with a table or
column rename (mirrors the existing index/foreign-key drift guard).

UNIQUE constraint *emission* stays out of scope this wave — a changed
`.unique()` flag still throws `unsupported-column-alter`, now with a
reason (table-level, not expressible as a column alter).
