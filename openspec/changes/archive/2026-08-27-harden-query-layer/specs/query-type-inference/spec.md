# Delta: query-type-inference

## Purpose

Makes the mutation builders accept the very TypeScript types the column
DSL declares as read types (closing #322): mode-resolved numerics, the
structured interval value, and arrays of those, with write values
round-tripping through the declared read type.

## MODIFIED Requirements

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require columns that are `notNull` without a
default and accept the rest as optional; update input types SHALL accept
any declared column as optional. For every column, the VALUE type
accepted SHALL be the column's own declared read type: a
`bigint`/`numeric` column accepts the type its resolved mode reads back
as (`bigint`, `number`, or `string`), an `interval` column accepts the
structured interval value, a datetime column (`date`/`timestamp`/
`timestamptz`) accepts exactly `Date` (never a plain ISO string), and an
array column accepts an array of its declared element type — except a
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
