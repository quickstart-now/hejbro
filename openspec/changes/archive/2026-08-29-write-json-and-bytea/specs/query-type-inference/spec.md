# query-type-inference (delta)

## MODIFIED Requirements

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require every `notNull` column without a default
and accept the rest as optional; update input types SHALL accept every
column as optional. Each column's accepted value type SHALL be its own
declared read type, so a value the column could never read back is not a
value it accepts:

- a `bigint`/`numeric` column accepts exactly what its resolved mode
  reads back as, never a sibling mode's shape
- an `interval` column accepts a structured interval value
- a `date`/`timestamp`/`timestamptz` column accepts exactly `Date`
- a `json`/`jsonb` column accepts any JSON-serializable value, which the
  query layer serializes; the column's declared type — `json` or `jsonb`
  — SHALL decide the cast, so a `json` column is never written through a
  `jsonb` cast and never acquires jsonb's key reordering
- a `bytea` column accepts a `Uint8Array`, which the query layer
  hex-encodes; a string SHALL NOT be accepted, because its encoding would
  have to be guessed
- an array column whose element type is `json`, `jsonb` or `bytea` SHALL
  accept only an `Expr`: those element types need their own array-literal
  escaping rules

A `.$type<T>()` brand SHALL narrow the write type as well as the read
type — a branded column accepts `T` and nothing wider.

Every column SHALL additionally accept an `Expr` (the `sql` escape
hatch), and a written value SHALL reach the database as a bind parameter,
never as text spliced into the statement.

#### Scenario: Insert input requires what the declaration requires
- **WHEN** a table declares a `notNull` column without a default
- **THEN** that key is required on the insert input type, and optional on
  the update input type

#### Scenario: A json value is written without hand-serialization
- **WHEN** an insert or update writes a plain object to a `jsonb` column
- **THEN** it type-checks, the compiled statement carries the serialized
  document as a bind parameter, and reading the row back yields an equal
  value

#### Scenario: A brand narrows the write as well as the read
- **WHEN** a `jsonb().$type<T>()` column is written a value that is not a
  `T`
- **THEN** it fails to type-check

#### Scenario: Bytes are written as bytes
- **WHEN** a `bytea` column is written a `Uint8Array`
- **THEN** it type-checks, the value is hex-encoded into a bind
  parameter, and reading the row back yields the same bytes; a string is
  refused
