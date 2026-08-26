# Delta: query-builder

## Purpose

Lets users build typed SQL statements (select, insert, update, delete)
against their declared schema and compile them purely to previewable
SQL text plus parameters, without touching a database.

## ADDED Requirements

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
in a declaration is valid in a query.

#### Scenario: Declaration helper used in a query filter
- **WHEN** a `where` condition is built with an existing expression
  helper (for example an equality over a declared column)
- **THEN** it compiles to the same SQL text that helper renders in
  declaration contexts, with literal values lifted to bind parameters

### Requirement: Typed sql escape hatch
The query package SHALL provide a typed `sql` tagged template usable as
a statement or embedded as an expression fragment. Interpolated values
SHALL become bind parameters, never inlined literals; interpolated
fragments and identifiers compose structurally.

#### Scenario: Escape hatch parameterizes interpolations
- **WHEN** a `sql` template interpolates a runtime value
- **THEN** the compiled SQL contains a parameter placeholder for it and
  the value appears only in the parameter list

### Requirement: Pure and deterministic compile
`compile()` SHALL be a pure function from a built statement to SQL text
plus an ordered parameter list: no I/O, no connection, and identical
input SHALL produce byte-identical output.

#### Scenario: Compile without any database
- **WHEN** a statement is compiled in a process with no database
  connection configured
- **THEN** it returns the SQL text and parameters, and compiling the
  same statement again returns byte-identical results
