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
in a declaration is valid in a query.

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

### Requirement: Typed sql escape hatch
The query package SHALL provide a typed `sql` tagged template usable as
a statement or embedded as an expression fragment. Interpolated values
SHALL become bind parameters, never inlined literals; interpolated
fragments and identifiers compose structurally.

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
