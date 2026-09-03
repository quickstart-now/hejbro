# query-execution (delta)

## MODIFIED Requirements

### Requirement: Result values are converted to their declared type
A row value returned for a column with a declared type carrying its own
runtime conversion (numeric width mode, `interval`) SHALL be converted
to that declared TypeScript shape before the caller receives it — and
for an array column of such a type, the conversion SHALL apply to each
element, producing an array of the declared element shape (a SQL `NULL`
element passes through as `null`, exactly as a `NULL` scalar does). For
a column declared `.notNullElements()`, a `NULL` element arriving at
all SHALL be treated as a conversion failure — the declared element
type excludes `null` because a CHECK enforces it, so an arriving `NULL`
means the constraint no longer holds (e.g. dropped out-of-band) and the
declared type must fail loudly rather than lie silently. A value that
fails to convert — an unconvertible element included — or a declared
column entirely absent from the driver's row, SHALL fail fast with an
explicit error naming the column, rather than surfacing as an
unconverted value or a silent `undefined`. An array column's raw value
that does not match the arrival shape its declared element type's
driver contract promises SHALL likewise be treated as a conversion
failure — fail fast naming the column, never guessed at or coerced
into the expected shape. Whether the failure is an unconvertible
element, an arrival-shape mismatch, unparsable array-literal text, or a
`NULL` element where the declaration forbids one, the column's whole
value SHALL fail — never a partial array standing in for it.

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

#### Scenario: An array arrival-shape mismatch fails fast, never partially converted
- **WHEN** an array column's raw value does not match the arrival shape
  its declared element type's driver contract promises (for example, a
  raw array-literal text value for an element type that is contracted
  to arrive as an already-parsed array, or the reverse)
- **THEN** the call rejects with an explicit error naming that column,
  and the caller never receives a partial array for it

#### Scenario: A NULL element under notNullElements fails fast
- **WHEN** a select resolves a `.notNullElements()` column whose raw
  driver value contains a `NULL` element (the backing CHECK was dropped
  or bypassed out-of-band)
- **THEN** the call rejects with an explicit error naming that column,
  and the caller never receives a `null` typed as the bare element type
