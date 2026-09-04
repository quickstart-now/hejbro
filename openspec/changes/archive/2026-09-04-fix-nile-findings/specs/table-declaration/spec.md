## MODIFIED Requirements

### Requirement: Non-null array elements are declared, and the constraint backs the claim
An array column SHALL be declarable as holding no `NULL` elements via
`.array().notNullElements()`. Declaring it SHALL add a CHECK constraint
to the table's generated migration, named `<column>_no_null_elements`
(the SQL column name, snake_case) with the expression
`array_position(<column>, null) is null`, the column reference
rendered by table and column exactly as every hand-declared check's is
(e.g. `array_position("posts"."tags", null) is null`) — the
database enforces
exactly what the narrowed type claims, so the narrowing is never an
unchecked assertion. The constraint SHALL participate in
diffing/removal exactly as a hand-declared check does: removing the
declaration (or the column) drops it, and a name collision with a
hand-declared check of the same name SHALL fail declaration loudly.
Calling `notNullElements()` on a non-array column SHALL fail fast at
declaration time with an explicit error naming the column, never
silently no-op.

#### Scenario: Declaring notNullElements emits the backing check
- **WHEN** a table `app.posts` declares
  `tags: text().array().notNullElements()`
- **THEN** the generated migration for that table contains a CHECK
  constraint named `tags_no_null_elements` with the expression
  `array_position("posts"."tags", null) is null`

#### Scenario: Removing the declaration drops the check
- **WHEN** a previously generated `notNullElements` declaration is
  removed while the column stays
- **THEN** the next migration drops the `<column>_no_null_elements`
  check, exactly as removing a hand-declared check would

#### Scenario: Misuse on a non-array column fails fast
- **WHEN** `notNullElements()` is called on a column that is not an
  `.array()` column
- **THEN** declaration fails with an explicit error naming the column,
  never a silently ignored call

## ADDED Requirements

### Requirement: A table-bound expression names columns by table and column
An expression that belongs to one table — a check constraint's
expression, a partial index's predicate, an index expression, a generated
column's expression, and a policy's `using` or `with check` — SHALL render
every column reference as `"table"."column"`, never schema-qualified,
whether the reference sits at the expression's top level or inside a
subquery the expression contains. The table an expression belongs to is
fixed by the statement it sits in, so a schema qualifier adds nothing
there — and a platform that keeps a table under an internal schema name
rejects the qualified form outright.

A row source named in a subquery's `from` or `join` SHALL stay
schema-qualified: it is the statement naming a table, not a column.

Where a subquery in scope brings in a row source whose bare table name
equals the referenced table's under a different schema, the reference
SHALL render schema-qualified, so the two-part form never becomes
ambiguous.

Expressions outside a table-bound site — a view body, a function body, a
statement built by the query builder — SHALL render exactly as they do
today. Rename tracking is unaffected: the reference is stored as a
structured node, and only its rendering changes.

#### Scenario: A check constraint names its own columns by table and column
- **WHEN** a table `lab.projects` declares a check
  `length(btrim(name)) > 0` over its own `name` column
- **THEN** the generated constraint reads
  `check (length(btrim("projects"."name")) > 0)`

#### Scenario: A partial-index predicate names its own columns by table and column
- **WHEN** a table `lab.projects` declares a partial index
  `where archived_at is null`
- **THEN** the generated index reads
  `... where "projects"."archived_at" is null`

#### Scenario: An index expression names its own columns by table and column
- **WHEN** a table `app.users` declares an index over `lower(email)`
- **THEN** the generated index reads `((lower("users"."email")))`

#### Scenario: A generated column's expression names its own columns by table and column
- **WHEN** a table declares a generated column whose `sql` fragment
  interpolates a sibling column
- **THEN** the generated column's expression renders that sibling as
  `"<table>"."<column>"`

#### Scenario: A policy names columns by table and column inside a correlated subquery too
- **WHEN** a policy on `app.tasks` reads
  `exists (select 1 from app.projects where projects.id = tasks.project_id and projects.archived_at is null)`
- **THEN** the policy renders
  `exists (select 1 from "app"."projects" where ("projects"."id" = "tasks"."project_id") and ("projects"."archived_at" is null))`
  — the subquery's `from` target stays schema-qualified, every column
  reference is two-part

#### Scenario: A same-named row source in scope keeps the reference schema-qualified
- **WHEN** a policy on `app.tasks` contains a subquery whose `from`
  names `audit.tasks`
- **THEN** references to `app.tasks` columns inside that subquery render
  as `"app"."tasks"."<column>"`, and references to `audit.tasks` columns
  as `"audit"."tasks"."<column>"`

#### Scenario: A view body is unchanged
- **WHEN** a view selects `app.posts.title` from `app.posts`
- **THEN** its body renders the projected column schema-qualified,
  exactly as before
