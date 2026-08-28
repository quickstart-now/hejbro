# query-builder (delta)

## ADDED Requirements

### Requirement: Nested reads compile to visible correlated subqueries
`jsonArrayFrom(subselect)` SHALL wrap a select statement into a
projection expression that compiles to a correlated scalar subquery
aggregating the subselect's rows into a JSON array
(`coalesce((select json_agg(...) from ...), '[]'::json)` shape), and
`jsonObjectFrom(subselect)` SHALL compile to a correlated scalar
subquery returning the subselect's single row as a JSON object, or
SQL `null` when no row matches. The subselect is the ordinary select
builder — its `where`/`orderBy`/`limit` and its own nested
`jsonArrayFrom`/`jsonObjectFrom` projections all carry through — and
it MAY reference the enclosing query's columns (the correlation); an
identifier resolvable in neither scope SHALL keep failing with the
existing foreign-column diagnostic. The entire emitted SQL, casts
included, SHALL be visible through `compile()` — no hidden statements,
no second round trip.

#### Scenario: A collection compiles to one correlated aggregate subquery
- **WHEN** a projection includes `comments: jsonArrayFrom(select({...},
  comments).where(eq(comments.postId, posts.id)).orderBy(...))`
- **THEN** `compile()` shows a single SELECT whose projection carries a
  correlated `(select coalesce(json_agg(...), '[]') ...)` subquery, and
  executing it yields one row per parent

#### Scenario: Nesting composes without new syntax
- **WHEN** the subselect's own projection includes a
  `jsonObjectFrom(...)` (a grandchild read)
- **THEN** the statement compiles with the inner correlated subquery
  nested inside the outer one, both visible in `compile()`

### Requirement: related() derives nested reads from declared foreign keys
`.related({...})` on a select chain SHALL attach nested reads derived
from declared foreign keys, compiling to exactly the correlated
subqueries the explicit `jsonArrayFrom`/`jsonObjectFrom` forms produce.
A reverse edge (tables referencing the selected table) SHALL be keyed
by the referencing table's name in the schema map and read as a
collection; a forward edge (a foreign-key column on the selected
table) SHALL be keyed by the column's TypeScript name with one
trailing `Id` stripped (the column name unchanged when it has no `Id`
tail) and read as a single row. v1 accepts only `true` per key and
only direct (depth-1) relations — richer shapes are written in the
explicit form. A key that matches no derivable relation, a key whose
derivation collides with another key or with a projected column name,
and a `related()` call on a table with no derivable relations SHALL
each fail to type-check rather than guessing.

#### Scenario: Reverse and forward sugar compile like the explicit form
- **WHEN** `db(h).select(posts).related({ comments: true, owner: true })`
  runs against declarations where `comments.postId` references
  `posts.id` and `posts.ownerId` references `users.id`
- **THEN** its `compile()` output equals the explicit
  `jsonArrayFrom`/`jsonObjectFrom` formulation of the same reads, with
  `comments` an array key and `owner` a single-row key

#### Scenario: An unknown relation key is rejected at compile time
- **WHEN** `related({ commets: true })` misspells a relation
- **THEN** the program fails to type-check, naming the offending key
