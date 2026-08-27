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
unconverted value or a silent `undefined`. An array column's raw value
that does not match the arrival shape its declared element type's
driver contract promises SHALL likewise be treated as a conversion
failure — fail fast naming the column, never guessed at or coerced
into the expected shape. Whether the failure is an unconvertible
element, an arrival-shape mismatch, or unparsable array-literal text,
the column's whole value SHALL fail — never a partial array standing
in for it.

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

## RENAMED Requirements

- FROM: `### Requirement: The chain surface is uniform across every execution surface`
- TO: `### Requirement: Statement typing and the chain surface are uniform across every execution surface`

### Requirement: Statement typing and the chain surface are uniform across every execution surface
The same thenable `select`/`insert`/`update`/`deleteFrom` chain entry
points, built from one shared factory, SHALL exist with identical
members on the unscoped db handle, the `db.as(context)` scoped handle,
and the `tx` a `transaction()` callback receives — and every one of
those surfaces SHALL resolve a statement's inferred result types
identically, `execute` included. Applying a context can never cover
one of these surfaces while missing another, and no surface
under-promises the types the others resolve. (Renamed from "The chain
surface is uniform…": the requirement broadened — with #326 closed,
uniformity covers `execute`'s own typing, not only the chain members.)

#### Scenario: A scoped chain runs inside its context-applied transaction
- **WHEN** a chain member is awaited on a `db.as(context)` handle
- **THEN** the role/setting statements that context applies and the
  chain's own statement all land on that one transaction, in that order

#### Scenario: A tx chain shares the callback's one open connection
- **WHEN** a chain member is awaited on the `tx` a `transaction()`
  callback received
- **THEN** its statement runs on that same held connection, never a
  fresh one

#### Scenario: tx.execute resolves the same inferred types as every other surface
- **WHEN** `tx.execute(statement)` is called on the same `tx` a chain
  member is also available on
- **THEN** it resolves the statement's inferred result type — the same
  type `db.execute` and the chain member resolve — at both `tx`
  creation sites (the previously tracked #326 asymmetry is closed)
