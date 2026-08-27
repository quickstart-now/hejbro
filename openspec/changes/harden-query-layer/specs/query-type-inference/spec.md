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
structured interval value, and an array column accepts an array of its
declared element type. A value supplied through these input types SHALL
store the equivalent database value — reading it back yields the value
that was written, in the declared read shape.

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
  those values in the declared read shapes

#### Scenario: A value outside the declared type is rejected at compile time
- **WHEN** an insert supplies a `number` to a default-mode (`'bigint'`)
  `bigint` column or a plain string to an `interval` column
- **THEN** the program fails to type-check rather than accepting a
  value the declared read type could never produce
