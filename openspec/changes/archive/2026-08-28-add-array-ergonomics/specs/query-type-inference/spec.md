# query-type-inference (delta)

## MODIFIED Requirements

### Requirement: Result types are inferred from declarations
The result row type of a select or `returning` clause SHALL be inferred
from the declared column types of the projected columns, including
nullability: a column without `notNull` SHALL type as possibly `null`.
An array column's element type SHALL include `| null` — Postgres arrays
are element-nullable regardless of the column's own `notNull`, and the
runtime delivers a `NULL` element as `null` — except a column declared
`.notNullElements()`, whose element type SHALL be the bare element type
(the emitted CHECK backs the claim). A projection built from arbitrary
expressions rather than a whole declared table (an object projection,
e.g. `select({a: expr}, table)`) SHALL still key its result exactly to
the projected names, but MAY resolve each field's type only to its
coarse SQL family widened to nullable, rather than the full
declared-column type — expressions carry no link back to the declared
column they read from (tracked as **#311**), so a narrower type there
would risk misrepresenting a value this layer cannot actually verify.

#### Scenario: Projection drives the row type
- **WHEN** a select projects a subset of a declared table's columns
- **THEN** the statement's result type contains exactly those column
  names with TypeScript types mapped from their declared SQL types

#### Scenario: An object projection's field type is coarser than a whole-table projection's
- **WHEN** a select's projection is built from expressions rather than
  the whole declared table
- **THEN** the result type keys still match exactly what was projected,
  but each field's type reflects only its SQL family widened to
  nullable, not the full declared-column type (mode/array
  element/`$type` brand are not reflected)

#### Scenario: Array element nullability follows the declaration
- **WHEN** a table declares `tags: text().array()` and
  `labels: text().array().notNullElements()`
- **THEN** a whole-table select's row type reads `tags` with elements
  typed `string | null` and `labels` with elements typed `string`

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require columns that are `notNull` without a
default and accept the rest as optional; update input types SHALL accept
any declared column as optional. For every column, the VALUE type
accepted SHALL be the column's own declared read type: a
`bigint`/`numeric` column accepts the type its resolved mode reads back
as (`bigint`, `number`, or `string`), an `interval` column accepts the
structured interval value, a datetime column (`date`/`timestamp`/
`timestamptz`) accepts exactly `Date` (never a plain ISO string), and an
array column accepts an array of its declared element type — elements
including `| null` by default, and excluding it for a column declared
`.notNullElements()` (matching the read side exactly) — except a
`json`/`jsonb`/`bytea` column (scalar or array-of), which has no
compile-time-lifted raw-value write path at all and accepts only an
`Expr` (the `sql` escape hatch). A value supplied through these input
types SHALL store the equivalent database value — reading it back yields
the value that was written, normalized within each axis (an interval
value's months/days/time axes are never converted into one another), in
the declared read shape. An interval write value's compiled bind
parameter carries an explicit `::interval` cast (`$n::interval`); a
`bigint`/array write value's own placeholder is bare, relying on the
target column to resolve the parameter's type.

#### Scenario: Defaulted column is optional on insert
- **WHEN** a table declares a `notNull` column with a default and a
  plain `notNull` column
- **THEN** the insert input type requires the plain column and marks the
  defaulted column optional

#### Scenario: Mode-resolved and interval values are accepted and round-trip
- **WHEN** an insert supplies a `bigint` value to a default-mode
  `bigint` column, a string to a `'string'`-mode `numeric` column, and
  a structured interval value to an `interval` column
- **THEN** the insert type-checks, and reading the row back yields
  those values in the declared read shapes, the interval value
  normalized within each axis

#### Scenario: A value outside the declared type is rejected at compile time
- **WHEN** an insert supplies a `number` to a default-mode (`'bigint'`)
  `bigint` column, a plain string to an `interval` column, or a plain
  ISO string to a `timestamptz` column
- **THEN** the program fails to type-check rather than accepting a
  value the declared read type could never produce

#### Scenario: json/jsonb and bytea columns accept only an Expr, never a raw value
- **WHEN** an insert supplies a plain object to a `jsonb` column or a raw
  `Uint8Array` to a `bytea` column (scalar or array-of either)
- **THEN** the program fails to type-check; only `sql\`...\`` (an `Expr`)
  is accepted for either column

#### Scenario: A null element is rejected only where the declaration forbids it
- **WHEN** an insert supplies `["a", null]` to a plain `text().array()`
  column and to a `text().array().notNullElements()` column
- **THEN** the plain column type-checks (and stores a `NULL` element),
  while the `notNullElements` column fails to type-check
