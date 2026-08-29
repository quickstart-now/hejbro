# query-builder (delta)

## ADDED Requirements

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

A `not materialized` hint on a recursive entry SHALL NOT be refused.
Postgres ignores it there rather than erroring, and refusing it would make
the builder stricter than the database.

The recursive term SHALL be written against a reference whose columns come
from the anchor term, so that the row shape is fixed before self-reference
is possible.

#### Scenario: A tree is walked
- **WHEN** a recursive CTE anchors on the roots of a self-referencing table
  and joins children in its recursive term
- **THEN** the compiled SQL carries `with recursive … union all …`, and the
  database returns every descendant

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
