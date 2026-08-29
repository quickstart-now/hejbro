# Delta: table-declaration

## Purpose

An index column's `.on(...)` list was the one declaration site, out of
the four this capability already guards (a check's expression, an
index's own predicate, an index-expression column, a foreign key), that
accepted a plain column reference from a table other than the one
declaring the index — silently, when the two tables' column names
differed, and misdiagnosed as an unknown-column typo when they matched.
This delta closes that fourth site (#464).

## ADDED Requirements

### Requirement: A plain index column belongs to the table declaring the index

A plain index column (`.on(t.col)`, not an index expression) SHALL
belong to the table whose declaration is building the index. A column
reference resolved from a different table's declaration SHALL fail
declaration, naming the foreign column's own schema, table, and column,
rather than either passing silently or being reported as an unknown
column of the declaring table.

This joins the same diagnostic family an index's own predicate, an
index-expression column, and a check's expression already form for the
same mistake — a foreign column reaches the same outcome regardless of
which of the four positions it is written in.

#### Scenario: An index over another table's column is refused
- **WHEN** a table's index declares `.on(...)` with a column reference
  resolved from a different table's declaration
- **THEN** declaration fails, naming the foreign column's schema, table,
  and column, rather than building an index the generator would emit
  against the wrong table

#### Scenario: A same-named foreign column is refused, not misdiagnosed as unknown
- **WHEN** the foreign column shares its name with a column the
  declaring table does have (e.g. both tables declare `id`)
- **THEN** declaration still fails naming the foreign column by its own
  table, rather than passing silently (a name-only check would not tell
  the two `id` columns apart) or reporting the declaring table's own
  `id` as unknown
