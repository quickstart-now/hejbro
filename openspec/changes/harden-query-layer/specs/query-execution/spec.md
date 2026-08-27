# Delta: query-execution

## Purpose

Extends result conversion element-wise to array columns (closing #320
at the conversion layer) so that a declared array column's values reach
the caller in the declared element shape.

## MODIFIED Requirements

### Requirement: Result values are converted to their declared type
A row value returned for a column with a declared type carrying its own
runtime conversion (numeric width mode, `interval`) SHALL be converted
to that declared TypeScript shape before the caller receives it — and
for an array column of such a type, the conversion SHALL apply to each
element, producing an array of the declared element shape (a SQL `NULL`
element passes through as `null`, exactly as a `NULL` scalar does). A
value that fails to convert — an unconvertible element included — or a
declared column entirely absent from the driver's row, SHALL fail fast
with an explicit error naming the column, rather than surfacing as an
unconverted value or a silent `undefined`.

#### Scenario: Declared numeric/interval columns arrive converted
- **WHEN** a select resolves a column declared with a numeric width mode
  or as `interval`
- **THEN** the value the caller receives matches that declared mode's
  TypeScript type (not the driver's raw text)

#### Scenario: Array columns arrive converted element-wise
- **WHEN** a select resolves an array column whose element type carries
  a runtime conversion (a moded `bigint`/`numeric` array, or an
  `interval` array)
- **THEN** the caller receives an array whose every non-null element
  has the declared element shape, and every `NULL` element is `null`

#### Scenario: An unconvertible or missing declared column fails fast
- **WHEN** a declared column's value — any array element included —
  cannot be converted to its declared type, or the declared column is
  entirely absent from the driver's row
- **THEN** the call rejects with an explicit error naming that column
