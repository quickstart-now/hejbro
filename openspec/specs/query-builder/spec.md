# query-builder Specification

## Purpose

Lets users build typed SQL statements (select, insert, update, delete)
against their declared schema and compile them purely to previewable
SQL text plus parameters, without touching a database.

## Requirements

### Requirement: Select statements over declared tables
The query package SHALL build select statements from declared tables
with an explicit column projection, optional `where`, `order`, `limit`,
and inner/left joins. The rendered SQL SHALL always list columns
explicitly and SHALL never contain `select *`.

#### Scenario: Basic select with filter, order, and limit
- **WHEN** a select over a declared table picks named columns and adds a
  `where` condition, an `order`, and a `limit`
- **THEN** compiling yields one SQL statement listing exactly the picked
  columns, with the condition values passed as bind parameters, and the
  given ordering and limit

#### Scenario: Inner and left join between declared tables
- **WHEN** a select joins a second declared table with an inner or left
  join on a column equality
- **THEN** the compiled SQL contains the corresponding `join` /
  `left join` clause and every projected column stays schema-qualified
  and explicitly listed

### Requirement: Insert, update, and delete with explicit returning
The query package SHALL build insert, update, and delete statements for
declared tables. A `returning` clause SHALL require an explicit column
list; the rendered SQL SHALL never contain `returning *`.

#### Scenario: Insert with returning
- **WHEN** an insert provides row values and requests `returning` for
  named columns
- **THEN** the compiled SQL is a single parameterized `insert` statement
  whose `returning` clause lists exactly those columns

#### Scenario: Update and delete are always scoped
- **WHEN** an update or delete is compiled with a `where` condition
- **THEN** the compiled SQL carries that condition with its values as
  bind parameters

### Requirement: Condition expressions reuse the declaration vocabulary
Query conditions SHALL be built from the same expression helpers the
schema DSL uses (the core ExprNode vocabulary), so an expression valid
in a declaration is valid in a query. Every condition position — select
`where`, join `on`, update `where`, delete `where`, and the `related()`
chain's `where` — SHALL accept the same `Expr<"boolean"> |
Expr<"unknown">` union the declaration-side condition positions accept
(`check()`, partial-index `.where()`, RLS policy `using`/`withCheck`),
so a `sql` fragment, whose family cannot be narrowed at compile time,
needs no cast to be used as a condition.

#### Scenario: Declaration helper used in a query filter
- **WHEN** a `where` condition is built with an existing expression
  helper (for example an equality over a declared column)
- **THEN** it compiles to the same SQL text that helper renders in
  declaration contexts, with literal values lifted to bind parameters

#### Scenario: A lifted timestamp keeps its type context
- **WHEN** a condition or written value carries a timestamp literal, which
  a declaration would render as a cast string literal
- **THEN** the compiled SQL carries the placeholder with the same cast
  and the parameter is the ISO-8601 string, so the value's type is fixed
  by the statement rather than by driver-specific encoding

#### Scenario: A sql fragment is a condition wherever a declaration accepts one
- **WHEN** a `sql` fragment expressing a predicate the typed operators
  cannot build (a function call over a column compared to a value) is
  passed to a select `where`, a join `on`, or an update or delete
  `where`
- **THEN** it type-checks without a cast and compiles into the
  statement's condition position with its interpolated values as bind
  parameters

#### Scenario: A fragment condition composes with typed operators
- **WHEN** a `sql` fragment is combined with an operator-built condition
  through `and`/`or`
- **THEN** the combination type-checks and compiles as one condition
  tree, in the order written

### Requirement: Typed sql escape hatch
The query package SHALL provide a typed `sql` tagged template usable as
a statement or embedded as an expression fragment. Interpolated values
SHALL become bind parameters, never inlined literals; interpolated
fragments and identifiers compose structurally. A fragment SHALL be
usable in every position a statement admits an expression — projection,
written value, and condition alike — so the escape hatch has no position
it cannot reach.

The same fragment is medium-dependent by design: written into a
declaration it renders its interpolated values as quoted inline literals,
because migration SQL has to stay readable and diffable; compiled as part
of a query it lifts those same values to bind parameters. `sql.raw()` is
verbatim in both media.

#### Scenario: Escape hatch parameterizes interpolations
- **WHEN** a `sql` template interpolates a runtime value
- **THEN** the compiled SQL contains a parameter placeholder for it and
  the value appears only in the parameter list

### Requirement: Injection safety
A runtime value SHALL never reach the compiled SQL text as text. On every
path a value can enter a statement — a builder condition, an insert's
values, an update's `set`, a `returning` or select projection, and an
interpolation into the `sql` tagged template — the value SHALL appear only
in the ordered parameter list, with a placeholder in its place. Identifiers
SHALL always be rendered through the core identifier quoting rule, which
doubles an embedded double quote. `sql.raw()` SHALL be the single verbatim
path into the SQL text, and SHALL be documented as the one place a caller
takes responsibility for what it passes.

The only *values* rendered inline are ones that are not caller-supplied
text: a `limit`, which the builder has already validated as a
non-negative integer, and the internal `default` marker a multi-row
insert uses for a missing key. `sql.raw()` is not a value — it is SQL,
and the paragraph above governs it.

#### Scenario: Hostile value in a condition
- **WHEN** a `where` condition compares a column against the string
  `'; drop table users; --`
- **THEN** that string does not occur anywhere in the compiled SQL text,
  the condition renders against a placeholder, and the string appears in
  the parameter list

#### Scenario: Hostile value interpolated into the sql template
- **WHEN** a `sql` template interpolates the same hostile string
- **THEN** the compiled text carries a placeholder and the string is
  reachable only through the parameter list

#### Scenario: A value that looks like a placeholder
- **WHEN** a compiled value is itself the text `$1`
- **THEN** it changes neither the SQL text nor the numbering of any
  parameter, and stays a value in the parameter list

#### Scenario: Nested fragments compose structurally
- **WHEN** one `sql` fragment interpolates another that itself
  interpolates a value
- **THEN** the inner fragment is spliced structurally rather than as
  text, and its value becomes a parameter numbered by where it appears

#### Scenario: Raw SQL is the one verbatim path
- **WHEN** the same text is passed once through `sql.raw()` and once as
  an interpolated value
- **THEN** the raw text appears verbatim in the SQL while the
  interpolated one appears only as a parameter

#### Scenario: Identifiers are quoted, never concatenated
- **WHEN** a statement renders an identifier containing a double quote
- **THEN** the rendered identifier is quoted with that quote doubled, so
  it cannot terminate the identifier

### Requirement: Pure and deterministic compile
`compile()` SHALL be a pure function from a built statement to SQL text
plus an ordered parameter list: no I/O, no connection, and identical
input SHALL produce byte-identical output.

#### Scenario: Compile without any database
- **WHEN** a statement is compiled in a process with no database
  connection configured
- **THEN** it returns the SQL text and parameters, and compiling the
  same statement again returns byte-identical results

### Requirement: A thenable chain surface delegates to the single statement vocabulary
The query layer SHALL expose `select`/`insert`/`update`/`deleteFrom`
chain entry points on a db handle whose stages (`where`/`orderBy`/
`limit`/`innerJoin`/`leftJoin`/`returning`/`onConflictDoNothing`/
`onConflictDoUpdate`) delegate directly to the corresponding core
builder stage — the query layer SHALL NOT build a second statement
vocabulary of its own. A chain SHALL remain inert, issuing no statement
to any driver, until it is awaited; its `.compile()` method SHALL be a
pure preview that never touches a driver.

#### Scenario: A chain never sends a statement before being awaited
- **WHEN** a chain is built through any number of stages but never
  awaited
- **THEN** no statement reaches any driver at any point during that
  construction

#### Scenario: A chain's compile() equals compile() of the same statement
- **WHEN** a chain's `.compile()` is called instead of awaiting the
  chain
- **THEN** it returns byte-identical SQL text and parameters to calling
  `compile()` directly on the equivalent core builder statement, and no
  driver is touched

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

### Requirement: Set operations combine selects into one visible statement
A select chain SHALL offer `.union(other)`, `.unionAll(other)`,
`.intersect(other)`, `.intersectAll(other)`, `.except(other)`, and
`.exceptAll(other)`, each combining the current select with `other`
(another select, or a prior combination — nesting composes) into one
set-operation statement. The combined statement SHALL render as the
branches' own SQL joined by the operator keyword (`union`,
`union all`, `intersect`, …), with any `orderBy`/`limit` called AFTER
the combination applying to the WHOLE set — the SQL placement
Postgres itself gives them. The entire emitted SQL SHALL be visible
through `compile()`. A set-operation query SHALL be a valid view body:
`defineView` accepts it, the snapshot codec round-trips it
structurally (no format-version change — a new node kind is
vocabulary), and the view's declared column list resolves from the
LEFT branch, SQL's own naming rule.

#### Scenario: Union of two selects renders one statement
- **WHEN** `select(activeUsers).union(select(archivedUsers))` compiles
- **THEN** the SQL is the two branch selects joined by `union`, and
  awaiting it yields the deduplicated combined rows

#### Scenario: Whole-set order and limit attach after combination
- **WHEN** a combination chains `.orderBy(...).limit(3)`
- **THEN** the rendered `order by`/`limit` follow the LAST branch and
  govern the whole set, never a single branch

#### Scenario: Nesting composes
- **WHEN** `a.union(b).except(c)` compiles
- **THEN** the statement expresses `(a union b) except c` and renders
  each operator at its own nesting level

#### Scenario: A set-operation view round-trips
- **WHEN** `defineView` takes a union query and the declaration is
  snapshotted and read back
- **THEN** the diff against the unchanged declaration is empty and the
  view's column list equals the left branch's

### Requirement: Selects paginate and de-duplicate
A select SHALL support `offset`, `distinct`, and `distinct on (...)`.

`offset` SHALL be available after `limit` and on its own (a bare `offset`
is legal SQL), SHALL accept only a non-negative integer, and SHALL render
inline after `limit` — never as a bind parameter, the same rule `limit`
already follows, so the compiled statement stays reviewable. A set
operation SHALL carry a whole-set `offset` exactly as it already carries a
whole-set `limit`.

`distinct` and `distinctOn` SHALL be available only on the stage `select`
itself returns and exactly once, matching SQL's own placement between
`select` and the projection. `distinctOn` SHALL require at least one
column and SHALL render its columns before the projection; which row of
each group survives is decided by the statement's `order by`, as Postgres
defines it.

#### Scenario: A page is taken by the database
- **WHEN** a select chains `limit` then `offset`
- **THEN** the compiled SQL ends `limit <n> offset <m>` with both values
  inline and no parameters added, and the database returns exactly that
  page

#### Scenario: An offset without a limit compiles
- **WHEN** a select chains `offset` without `limit`
- **THEN** the compiled SQL carries the `offset` clause alone

#### Scenario: A negative or fractional row count is refused
- **WHEN** `limit` or `offset` is called with a negative or fractional
  number
- **THEN** the call fails immediately, naming the clause and the
  non-negative-integer rule

#### Scenario: distinct on takes one row per group
- **WHEN** a select applies `distinctOn` over a column and orders by that
  column followed by a descending tiebreaker
- **THEN** the compiled SQL renders `select distinct on (<column>)` before
  the projection, and the database returns one row per group — the one the
  ordering puts first

#### Scenario: distinct is settable once, first
- **WHEN** a chain has already joined, filtered, or ordered
- **THEN** `distinct`/`distinctOn` are not available on that stage, so a
  placement SQL would reject cannot be written

### Requirement: Selects aggregate and group
The builder SHALL provide the aggregate vocabulary — `count()`,
`countWhere(expr)`, `min`, `max`, `sum`, `avg` — and the `groupBy` and
`having` stages.

`groupBy` SHALL be available after `where` and SHALL require at least one
expression. `having` SHALL be available only after `groupBy`, and
`orderBy`/`limit`/`offset` SHALL still follow it: the chain admits
exactly SQL's own clause order, so a placement Postgres would reject is
not expressible.

Aggregates SHALL render as Postgres's own function names, with
`count()` rendering `count(*)`.

#### Scenario: Grouping with a group filter
- **WHEN** a select projects a column and `count()`, filters rows with
  `where`, groups by that column, filters groups with `having`, then
  orders and limits
- **THEN** the compiled SQL carries `where`, `group by`, `having`,
  `order by` and `limit` in that order, and the database returns only the
  groups `having` kept

#### Scenario: An empty group by is refused
- **WHEN** `groupBy()` is called with no expressions
- **THEN** it fails immediately, naming what to pass

#### Scenario: having is unavailable without grouping
- **WHEN** a chain has not called `groupBy`
- **THEN** `having` is not on that stage

### Requirement: Selects compute over windows
The builder SHALL provide the window vocabulary — `rowNumber`, `rank`,
`denseRank`, `percentRank`, `cumeDist`, `ntile`, `lag`, `lead`,
`firstValue`, `lastValue`, `nthValue` — and `over(expr, spec)`, which
takes either one of those or an existing aggregate and attaches a window
specification carrying `partitionBy` and `orderBy`.

Window functions SHALL render as Postgres's own function names followed by
`over (…)`, with `partition by` and `order by` in SQL's own order and
omitted when empty. A frame clause is not emitted; rendering none is
exactly Postgres's default.

The eleven window-only constructors SHALL NOT be usable where an
expression is expected until `over()` has wrapped them, because Postgres
rejects every one of them without an `OVER` clause.

#### Scenario: Ranking within a partition
- **WHEN** a select projects a column and `over(rank(), …)` partitioned by
  one column and ordered by another
- **THEN** the compiled SQL carries `rank() over (partition by … order by
  …)`, and the database restarts the ranking in each partition

#### Scenario: An aggregate becomes a running total
- **WHEN** a select projects `over(sum(column), { orderBy: [...] })`
- **THEN** the compiled SQL carries `sum(…) over (order by …)` and the
  aggregate keeps its own meaning, with no `group by` implied

#### Scenario: A window-only call must be wrapped
- **WHEN** `rowNumber()` is used directly as a projection
- **THEN** it is not accepted where an expression is required

#### Scenario: over refuses a target that is not a function call
- **WHEN** `over()` is given a plain column
- **THEN** it fails immediately, naming what may be wrapped

### Requirement: Window functions are refused where Postgres refuses them
`where()`, `groupBy()` and `having()` SHALL refuse an argument containing
a window function, failing at build time with a diagnostic that names the
clause, states that window functions are evaluated after it, and gives the
remedy. An aggregate SHALL likewise refuse an argument containing a window
function.

`distinctOn` SHALL NOT refuse one: Postgres accepts a window function
there, and refusing it would make the builder stricter than the database.

A window function inside a subquery's own select list SHALL remain legal —
the check does not descend into an embedded query.

#### Scenario: Filtering on a window result is refused
- **WHEN** a comparison against a window function is passed to `where`
- **THEN** it fails immediately, naming the clause and the evaluation
  order, and pointing at the select list or a subquery instead

#### Scenario: distinct on accepts a window function
- **WHEN** `distinctOn` is given a window function
- **THEN** the statement compiles, matching what Postgres accepts

#### Scenario: An aggregate refuses a windowed argument
- **WHEN** an aggregate is given an argument containing a window function
- **THEN** it fails immediately, matching Postgres's own separate rule

### Requirement: A window survives serialization
A view body carrying a window function SHALL round-trip through the
snapshot codec unchanged, and a rename SHALL rewrite column references
inside the window specification as it does anywhere else.

A stored window node missing its function call SHALL be rejected, not
repaired. The codec tolerates an absent field only where an older format
version genuinely wrote it out; `window` is new in this version, so its
absence is corruption rather than an older shape, and decoding it into a
plausible value would turn a damaged snapshot into a silently different
declaration.

#### Scenario: A view with a window function round-trips
- **WHEN** a view whose body projects a window function is serialized and
  read back
- **THEN** the decoded query is the same query, window specification
  included

#### Scenario: A rename reaches inside the window
- **WHEN** a column referenced only inside `over()`'s `partitionBy` is
  renamed
- **THEN** the stored expression names the new column, not the old one

#### Scenario: A damaged window node is refused, not repaired
- **WHEN** a stored window node has no function call
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described

### Requirement: Statements may name intermediate queries
The builder SHALL provide `with()` as a statement root, taking one or more
named queries and returning a stage on which the body statement is built.
Each named query SHALL be a select or a set operation.

A `WITH` SHALL render as `with <name> as (<query>)`, comma-separated in
declaration order, ahead of the body statement. Bound parameters SHALL be
numbered across the whole statement in rendered order — every literal
inside a CTE body is bound before the body statement's own.

An entry MAY carry a `materialized` hint, rendering as `as materialized
(…)` or `as not materialized (…)`. Omitting it SHALL render neither token
and leave the choice to the planner, which is Postgres's default.

#### Scenario: A named query is declared and used
- **WHEN** a statement declares one named query and selects from it
- **THEN** the compiled SQL carries `with <name> as (…)` followed by the
  body select, and the database returns the named query's rows

#### Scenario: Parameters are numbered across the whole statement
- **WHEN** a CTE body and the body statement each compare against a
  literal
- **THEN** the CTE body's literal is bound first, and the rendered text
  contains no inlined literal from either

#### Scenario: A materialization hint is emitted
- **WHEN** an entry is declared materialized, and another not materialized
- **THEN** each renders its own token, and an entry declaring neither
  renders no token at all

### Requirement: A CTE is a from-source
`from` SHALL accept a CTE reference as well as a table. A CTE reference
SHALL render unqualified — a CTE name is neither a schema nor a table —
and its column references SHALL render qualified by that bare name.

Scope checking SHALL treat the enclosing `WITH` list as the set of
available names: a column reference belonging to a CTE that the statement
does not declare SHALL be refused at build time, the way an out-of-scope
table reference already is.

A join SHALL accept a CTE reference as its target as well, so a CTE can be
joined back to the table it was derived from — the second half of "top N
per group", where the ranked CTE is rejoined to carry detail columns.

A rename SHALL NOT rewrite a CTE reference. Renames identify a table by
schema and name together, and a CTE has neither; a CTE that shares a
renamed table's name SHALL be left untouched.

A CTE body SHALL be part of the query for every purpose that walks one.
Scope checking, renames, parameter binding, and the table collection a
provider preset uses to warn about RLS bypass SHALL all reach inside it: a
table read only inside a CTE body is still a table this query reads, and
treating the body as opaque would silence a security warning rather than
answer it.

#### Scenario: Selecting from a named query
- **WHEN** a select's from-source is a CTE reference
- **THEN** the rendered SQL names it bare, with no schema qualification

#### Scenario: A column from an undeclared CTE is refused
- **WHEN** a statement references a column of a CTE it does not declare
- **THEN** it fails at build time, naming the reference and the statement's
  available sources

#### Scenario: A CTE is joined back to a table
- **WHEN** a select joins a CTE reference on a column of its from-table
- **THEN** the rendered SQL joins the bare CTE name, and the join
  condition's references resolve against both sources

#### Scenario: A table rename leaves a same-named CTE alone
- **WHEN** a table is renamed and a statement declares a CTE with the old
  table's name
- **THEN** the CTE's own column references are unchanged

#### Scenario: A table read inside a CTE body is still reported
- **WHEN** a view's body reads a table only inside a CTE, and the preset
  collects the tables that view reads
- **THEN** that table is among them, so an RLS-bypass warning is raised
  exactly as it would be for a direct read

### Requirement: Recursive CTEs traverse
The builder SHALL support recursive CTEs: an anchor term, a `UNION` — with
or without `all`, both of which Postgres's grammar allows — and a
recursive term that may reference the CTE being defined. `recursive` SHALL
be a property of the `WITH` list, not of an entry, matching Postgres's
grammar: one `with recursive` covers every entry in the list and has no
effect on the entries that do not recurse.

A recursive branch SHALL NOT offer `intersect` or `except`, and SHALL NOT
carry a whole-set `order by`, `limit` or `offset`: Postgres refuses all
four, the first as a recursion-structure violation and the rest as
unimplemented features.

Everything Postgres accepts in a recursive term SHALL remain accepted
here — a window function, `distinct`, `distinct on`, `group by`/`having`,
an aggregate in the anchor term, `union` as well as `union all`, and
either materialization hint on a recursive entry. The commonly recalled
restriction list is wider than the database's actual one, and refusing on
it would make the builder stricter than Postgres.

The recursive term SHALL be written against a reference whose columns come
from the anchor term, so that the row shape is fixed before self-reference
is possible.

#### Scenario: A tree is walked
- **WHEN** a recursive CTE anchors on the roots of a self-referencing table
  and joins children in its recursive term
- **THEN** the compiled SQL carries `with recursive … union all …`, and the
  database returns every descendant

#### Scenario: A window function survives inside a recursive term
- **WHEN** a recursive term projects a window function
- **THEN** the statement is accepted, as Postgres accepts it

#### Scenario: One recursive keyword covers the list
- **WHEN** a `WITH` list containing a recursive entry also contains a
  non-recursive one
- **THEN** the rendered SQL carries a single `with recursive`, with both
  entries under it

### Requirement: A WITH survives serialization
A view body carrying a `WITH` SHALL round-trip through the snapshot codec
unchanged, including entry order, the `recursive` flag, and each entry's
materialization hint.

A stored `with` node missing its body or its entry list SHALL be rejected,
not repaired: `with` is new in this format version, so an absent field is
corruption rather than an older shape, and decoding it into a plausible
value would turn a damaged snapshot into a silently different view.

#### Scenario: A view with a CTE round-trips
- **WHEN** a view whose body declares a CTE is serialized and read back
- **THEN** the decoded query is the same query, entry order and hints
  included

#### Scenario: A damaged with node is refused, not repaired
- **WHEN** a stored `with` node has no body
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described
