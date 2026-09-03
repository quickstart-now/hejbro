# query-builder Delta

## REMOVED Requirements

### Requirement: Set operations combine selects into one visible statement
**Reason**: Split into three requirements — combination/rendering, the
key-order guard, and view-body/serialization — because three independent
decisions shared one heading and partial revision forced whole-block
rewrites.
**Migration**: Content continues in the ADDED requirements "Set
operations combine selects and render as one statement", "Set-operation
branches must agree in key order", and "A set operation is a view body
and survives serialization" (decode leniency moves to snapshot-format's
decode-strictness requirement).

### Requirement: A window survives serialization
**Reason**: Decode strictness moved to snapshot-format (single codec
owner); the remaining round-trip/rename contract continues under a name
that no longer implies it owns decode policy.
**Migration**: Continues as the ADDED requirement "A window round-trips
through the snapshot codec"; the damaged-node scenario moves to
snapshot-format's decode-strictness requirement.

### Requirement: A WITH survives serialization
**Reason**: Same single-codec-owner move as the window requirement.
**Migration**: Continues as the ADDED requirement "A WITH round-trips
through the snapshot codec"; the damaged-node scenario moves to
snapshot-format's decode-strictness requirement.

## MODIFIED Requirements

### Requirement: Select statements over declared tables
The query package SHALL build select statements from declared tables
with an explicit column projection, optional `where`, `orderBy`, `limit`,
and inner/left joins. The rendered SQL SHALL always list columns
explicitly and SHALL never contain `select *`.

`orderBy` SHALL accept `asc(column)`/`desc(column)`, each optionally
carrying a `nulls: "first" | "last"` placement — the same vocabulary a
declared index's own column order accepts — and SHALL render Postgres's
own `nulls first`/`nulls last` suffix after the direction. A window
specification's own `orderBy` and a set operation's whole-set `orderBy`
accept the identical vocabulary, rendered the same way, rather than each
position inventing its own spelling.

#### Scenario: Basic select with filter, order, and limit
- **WHEN** a select over a declared table picks named columns and adds a
  `where` condition, an `orderBy`, and a `limit`
- **THEN** compiling yields one SQL statement listing exactly the picked
  columns, with the condition values passed as bind parameters, and the
  given ordering and limit

#### Scenario: Inner and left join between declared tables
- **WHEN** a select joins a second declared table with an inner or left
  join on a column equality
- **THEN** the compiled SQL contains the corresponding `join` /
  `left join` clause and every projected column stays schema-qualified
  and explicitly listed

#### Scenario: A nulls placement is spelled and rendered
- **WHEN** an `orderBy` calls `asc(column, { nulls: "first" })` or
  `desc(column, { nulls: "last" })`
- **THEN** the compiled SQL renders `nulls first`/`nulls last` right
  after the direction, and the same call compiles identically inside a
  window specification's `orderBy` and a set operation's whole-set
  `orderBy`

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
text: a `limit` and an `offset`, each already validated by the builder as
a non-negative integer, and the internal `default` marker a multi-row
insert uses for a missing key. This enumeration is exhaustive by design:
a change that renders any new value inline SHALL extend this list in the
same change. `sql.raw()` is not a value — it is SQL, and the paragraph
above governs it.

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

### Requirement: A thenable chain surface delegates to the single statement vocabulary
The query layer SHALL expose `select`/`insert`/`update`/`deleteFrom`
chain entry points on a db handle whose stages delegate directly to the
corresponding core builder stage — the query layer SHALL NOT build a
second statement vocabulary of its own. Every stage the core builder
provides SHALL exist on the chain under the same name with the same
semantics (`where`/`orderBy`/`limit`/`offset`/`distinct`/`distinctOn`/
`groupBy`/`having`/`innerJoin`/`leftJoin`/`returning`/
`onConflictDoNothing`/`onConflictDoUpdate`/`with`), so a stage added to
the core builder without its chain counterpart violates this
requirement rather than passing as an oversight. The set-operation
family (`union`/`unionAll`/`intersect`/`intersectAll`/`except`/
`exceptAll`) is the one deliberate exception to delegation: the chain
surface builds it independently (see the set-operation requirement),
and the no-second-vocabulary rule governs stage vocabulary, not that
family. A chain SHALL remain inert, issuing no statement to any driver,
until it is awaited; its `.compile()` method SHALL be a pure preview
that never touches a driver.

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

#### Scenario: Every builder stage reaches the chain
- **WHEN** a statement using any core builder stage vocabulary
  (`offset`, `distinctOn`, `groupBy`, `having`, `with` included) is
  expressed through the chain
- **THEN** the chain offers that stage under the same name and the two
  formulations compile byte-identically

### Requirement: Selects aggregate and group
The builder SHALL provide the aggregate vocabulary — `count()`, `min`,
`max`, `sum`, `avg` — and the `groupBy` and `having` stages.

`groupBy` SHALL be available after `where` and SHALL require at least one
expression. `having` SHALL be available only after `groupBy`, and
`orderBy`/`limit`/`offset` SHALL still follow it: the chain admits
exactly SQL's own clause order, so a placement Postgres would reject is
not expressible.

Aggregates SHALL render as Postgres's own function names, with
`count()` rendering `count(*)`. There is no separate filtered-count
constructor, and a `FILTER (WHERE …)` clause is deliberately not part
of the vocabulary: a filtered count is written through the `sql`
escape hatch until a real `FILTER` construct ships.

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

Everything Postgres's parser accepts in a recursive term SHALL remain
accepted here — `distinct`, `distinct on`, `group by`/`having`, `union`
as well as `union all`, and either materialization hint on a recursive
entry all parse and execute there. Two constructs carry a narrower claim,
each measured, and the wording here is no wider than what was measured:
an aggregate is accepted in the **anchor** term, not the recursive term —
Postgres refuses an aggregate in the recursive term itself (`42P19`,
"aggregate functions are not allowed in a recursive query's recursive
term", measured); a window function in the recursive term is not refused
at parse time, but the measured construct (`row_number() over ()`, whose
value does not advance with the recursion) never terminates rather than
returning a row — this is not evidence that window functions are illegal
in a recursive term, only that this particular construct does not
complete, and the builder does not refuse on Postgres's behalf either
way. The commonly recalled restriction list is wider than the database's
actual one, and refusing on it would make the builder stricter than
Postgres.

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
- **THEN** the statement is accepted at parse time, as Postgres accepts it
  — whether the specific window construct's recursion terminates is a
  property of that construct (`row_number() over ()`, measured, does not
  terminate), not something this builder refuses on Postgres's behalf

#### Scenario: One recursive keyword covers the list
- **WHEN** a `WITH` list containing a recursive entry also contains a
  non-recursive one
- **THEN** the rendered SQL carries a single `with recursive`, with both
  entries under it

### Requirement: related() derives nested reads from declared foreign keys
`.related({...})` on a select chain SHALL attach nested reads derived
from declared foreign keys, compiling to exactly the correlated
subqueries the explicit `jsonArrayFrom`/`jsonObjectFrom` forms produce.
A reverse edge (tables referencing the selected table) SHALL be keyed
by the referencing table's name in the schema map and read as a
collection; a forward edge (a foreign-key column on the selected
table) SHALL be keyed by the column's TypeScript name with one
trailing `Id` stripped (the column name unchanged when it has no `Id`
tail) and read as a single row. Only `true` per key and only direct
(depth-1) relations are accepted — richer shapes are written in the
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

## ADDED Requirements

### Requirement: Set operations combine selects and render as one statement
A select chain SHALL offer `.union(other)`, `.unionAll(other)`,
`.intersect(other)`, `.intersectAll(other)`, `.except(other)`, and
`.exceptAll(other)`, each combining the current select with `other`
(another select, or a prior combination — nesting composes) into one
set-operation statement. The combined statement SHALL render as the
branches' own SQL joined by the operator keyword (`union`,
`union all`, `intersect`, …), with any `orderBy`/`limit`/`offset`
called AFTER the combination applying to the WHOLE set — the SQL
placement Postgres itself gives them. The entire emitted SQL SHALL be
visible through `compile()`.

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

### Requirement: A window round-trips through the snapshot codec
A view body carrying a window function SHALL round-trip through the
snapshot codec unchanged, and a rename SHALL rewrite column references
inside the window specification as it does anywhere else. Decode
strictness for a stored window node is owned by snapshot-format's
decode-strictness requirement.

#### Scenario: A view with a window function round-trips
- **WHEN** a view whose body projects a window function is serialized and
  read back
- **THEN** the decoded query is the same query, window specification
  included

#### Scenario: A rename reaches inside the window
- **WHEN** a column referenced only inside `over()`'s `partitionBy` is
  renamed
- **THEN** the stored expression names the new column, not the old one

### Requirement: A WITH round-trips through the snapshot codec
A view body carrying a `WITH` SHALL round-trip through the snapshot codec
unchanged, including entry order, the `recursive` flag, and each entry's
materialization hint. Decode strictness for a stored `with` node is owned
by snapshot-format's decode-strictness requirement.

#### Scenario: A view with a CTE round-trips
- **WHEN** a view whose body declares a CTE is serialized and read back
- **THEN** the decoded query is the same query, entry order and hints
  included

### Requirement: Set-operation branches must agree in key order
A build-time guard SHALL refuse combining two branches whose projections
list the same key set in a different order, before either branch reaches
the server, naming both branches' own key order and the first position at
which they disagree.

Branch compatibility divides between two mechanisms, each covering what
the other cannot see: a key SET mismatch is caught by the type layer,
and a genuine TYPE divergence between two branches' same-named column
is caught by the server itself (`42804`, "UNION types uuid and text
cannot be matched" — measured, SQLSTATE captured). Neither catches a
branch pair whose keys match in SET but not in ORDER — which is what
this guard exists for, and why it is build-time by necessity. The type
layer cannot see order (`keyof` has no order), and Postgres matches
set-operation branches by POSITION, not by name, so a matching-set,
different-order pair is legal SQL to the server too — and silently
corrupts data instead of erroring (measured on postgres:17.11: unioning
`{email, city}` against `{city, email}` returns rows with the `email`
output column holding a city value and the `city` column holding an
email, reproduced in both a bare `select` and a `create view`).
`except` and `intersect` corrupt the same way, not only `union` —
`except` is the worst of the three: a position-mismatched comparison can
still return one plausible-looking row, so nothing about the result
signals that the wrong columns were compared.

The guard SHALL apply at every construction site a set operation can be
built from: the core builder, the query package's own chain surface, and
a recursive CTE's anchor/recursive-term pair (grammatically
`anchor UNION [ALL] recursive-term`) — the recursive-term type rule
(`query-type-inference`) compares key SETS and cannot see order either,
so this guard is the same rule applied to the same construct, not a
plain-union special case with an unstated recursive-CTE exception.

A snapshot decoded from disk is OUTSIDE this guard's reach: a
construction-time guard cannot run on a path that never constructs the
node. Decode leniency for stored set-operation nodes and the `verify`
backstop for hand-edited snapshots are owned by snapshot-format's
decode-strictness requirement.

#### Scenario: Branches with the same keys in a different order are refused
- **WHEN** two branches' projections list the same key set in a
  different order (e.g. `{email, city}` against `{city, email}`), via
  either the core builder or the query package's chain surface
- **THEN** the combinator call fails at build time, naming both
  branches' own key order and the first position at which they
  disagree, before either branch ever reaches the server

#### Scenario: A recursive CTE's anchor and recursive term are held to the same order rule
- **WHEN** `asRecursive`'s anchor and recursive term project the same
  key set in a different order
- **THEN** the call fails at build time the same way a plain union's
  branches would, naming both orders and the first disagreeing
  position

#### Scenario: A hand-assembled set-op node bypasses the guard
- **WHEN** a set-operation node is constructed directly (never through a
  combinator) or decoded from a stored snapshot
- **THEN** this guard, which runs only at combinator construction time,
  does not re-check it — the decode path's own rules and the `verify`
  backstop (snapshot-format) cover that surface

### Requirement: A set operation is a view body and survives serialization
A set-operation query SHALL be a valid view body: `defineView` accepts
it, the snapshot codec round-trips it structurally (no format-version
change — a new node kind is vocabulary), and the view's declared column
list SHALL resolve from the LEFT branch, SQL's own naming rule. Decode
leniency for a stored set-operation node is owned by snapshot-format's
decode-strictness requirement.

#### Scenario: A set-operation view round-trips
- **WHEN** `defineView` takes a union query and the declaration is
  snapshotted and read back
- **THEN** the diff against the unchanged declaration is empty and the
  view's column list equals the left branch's

### Requirement: Inserts resolve conflicts explicitly
An insert SHALL offer `onConflictDoNothing(...target)` and
`onConflictDoUpdate({ target, set })` before `returning`, rendering
Postgres's own `on conflict (<target columns>) do nothing` and
`on conflict (<target columns>) do update set <assignments>` clauses. A
conflict target SHALL name at least one declared column of the inserted
table, rendered through the identifier quoting rule; an empty target
SHALL fail fast at build time with `empty-conflict-target` — Postgres
rejects `on conflict ()` at parse time, so the clause must not be
constructible into broken SQL. The target-less form Postgres itself
accepts (`on conflict do nothing`, matching any conflict) is
deliberately not part of the vocabulary: a target is required, and a
statement needing the bare form is written through the `sql` escape
hatch. `onConflictDoUpdate`'s `set` SHALL accept
exactly what an update's `set` accepts for that table — declared write
types, `Expr` included — with every value reaching the database as a
bind parameter. `returning` SHALL remain available after either conflict
stage and reports the rows the statement actually returned.

#### Scenario: A do-nothing conflict clause renders and skips
- **WHEN** an insert chains `onConflictDoNothing(col)` on a column with a
  unique constraint and a conflicting row is inserted
- **THEN** the compiled SQL carries `on conflict ("<col>") do nothing`,
  the statement succeeds, and no row is written

#### Scenario: A do-update conflict clause upserts with parameterized values
- **WHEN** an insert chains `onConflictDoUpdate({ target: [col], set:
  {...} })` and a conflicting row exists
- **THEN** the compiled SQL carries `on conflict ("<col>") do update set
  …` with the set values as bind parameters, and the conflicting row is
  updated

#### Scenario: The chain's conflict stages compile like the builder's
- **WHEN** the same conflicting insert is expressed through the chain and
  through the core builder
- **THEN** the two compile to byte-identical SQL and the same parameter
  order

#### Scenario: An empty conflict target is refused, never rendered
- **WHEN** `onConflictDoNothing()` is called with no columns, or
  `onConflictDoUpdate` with an empty `target`
- **THEN** the call fails at build time with `empty-conflict-target`,
  naming the fix, so `on conflict ()` is never reachable through the
  public builder or chain stages — the guard runs at construction, the
  same boundary the set-operation key-order guard draws
