# query-execution Delta

## REMOVED Requirements

### Requirement: Callback-scoped transactions
**Reason**: Its single scenario carried two WHEN/THEN pairs, breaking
the one-scenario-one-verification format invariant.
**Migration**: Continues as the ADDED requirement "Transactions are
callback-scoped", with the commit and rollback paths as separate
scenarios.

### Requirement: Result values are converted to their declared type
**Reason**: Split — scalar conversion, array element conversion, and
whole-value failure atomicity are independently revisable decisions
that shared one heading.
**Migration**: Continues in the ADDED requirements "Scalar result
values convert to their declared type", "Array results convert
element-wise and arrive in the contracted shape", and "A failed
conversion fails the whole column value".

## MODIFIED Requirements

### Requirement: Database errors propagate with context
Execution failures reported by the database SHALL surface to the caller
carrying the driver's underlying error as the cause; the query layer
SHALL NOT swallow, retry, or reinterpret them. The thrown error's
message SHALL lead with the driver's own message — the reason survives
where long text is truncated — followed by the executed statement's
parameterized SQL text (every value already a bind-parameter
placeholder). A cause with no usable message SHALL be named as such in
the message, never interpolated as `undefined` or an object's default
string form.

The query layer itself SHALL NEVER write the statement's parameter
*values* onto the thrown error — not into the message (the SQL stays
parameterized; the params array is never read on this path), not as an
enumerable field, not via the error's string or JSON representation.
Text the database echoes inside its own error message or fields is the
database's report and is carried faithfully, not scrubbed.

#### Scenario: Constraint violation reaches the caller
- **WHEN** an executed insert violates a declared unique constraint
- **THEN** the call rejects with an error whose message leads with the
  driver's own message (the constraint's name included, when the driver
  reports it), exposing the underlying database error as `cause`, and no
  automatic retry occurs

#### Scenario: Parameter values never reach the thrown error
- **WHEN** an executed, parameterized statement fails
- **THEN** the thrown error's message contains the statement's SQL text
  with bind-parameter placeholders, and the value bound to each
  placeholder is nowhere written by the query layer — not in the
  message's SQL text, not as a field, not via the error's string or
  JSON form

#### Scenario: A server-echoed value is carried, not scrubbed
- **WHEN** the driver's own error message or fields quote a value the
  server echoed back
- **THEN** the thrown error's message carries the driver's message
  verbatim — fidelity to the database's report wins over scrubbing text
  this layer did not write

#### Scenario: A non-error cause is named, not interpolated
- **WHEN** the driver rejects with a value that is not an `Error` or has
  no message
- **THEN** the thrown error's message names the absence of a driver
  message and still carries the statement's parameterized SQL text

### Requirement: Statement typing and the chain surface are uniform across every execution surface
The same thenable `select`/`insert`/`update`/`deleteFrom` chain entry
points, built from one shared factory, SHALL exist with identical
members on the unscoped db handle, the `db.as(context)` scoped handle,
and the `tx` a `transaction()` callback receives — and every one of
those surfaces SHALL resolve a statement's inferred result types
identically, `execute` included. Applying a context can never cover
one of these surfaces while missing another, and no surface
under-promises the types the others resolve.

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
  creation sites

### Requirement: A failing savepoint release is recovered and reported
A statement error swallowed inside a nested callback leaves the
subtransaction aborted, so the `RELEASE SAVEPOINT` that follows a normal
return fails. The query layer SHALL attempt `ROLLBACK TO SAVEPOINT`
before giving up, and SHALL surface `savepoint-release-failed` carrying
the release failure as its cause. The error SHALL advise rethrowing inside
the nested callback rather than swallowing, since a swallowed statement
error is what puts the subtransaction in this state.

If the recovery rollback itself fails, the rollback-failure path SHALL
take over — that failure is about the connection, not about this one
savepoint — raising the savepoint-rollback-failure error carrying both
failures.

#### Scenario: A swallowed statement error surfaces at release
- **WHEN** a nested callback swallows a statement error and returns
  normally
- **THEN** the release fails, a rollback to the savepoint is attempted,
  the savepoint is then released so none outlives its nested
  transaction, and `savepoint-release-failed` is raised naming the
  swallowed error as the cause of the state and rethrow as the fix —
  never a bare `query-execution-failed`

#### Scenario: A failing recovery rollback falls through
- **WHEN** the release fails and the rollback attempted to recover from
  it also fails
- **THEN** the savepoint-rollback-failure error is raised, carrying both
  failures

## ADDED Requirements

### Requirement: Transactions are callback-scoped
The db handle SHALL provide a transaction API that runs a callback's
statements on one connection inside `begin`/`commit`, rolling back when
the callback throws, and requiring the driver's interactive-transaction
capability.

#### Scenario: Commit on success
- **WHEN** a transaction callback completes normally
- **THEN** its statements are committed atomically

#### Scenario: Rollback on throw
- **WHEN** a transaction callback throws
- **THEN** the transaction is rolled back and the thrown error
  propagates to the caller unchanged

### Requirement: Scalar result values convert to their declared type
A row value returned for a column with a declared type carrying its own
runtime conversion (numeric width mode, `interval`) SHALL be converted
to that declared TypeScript shape before the caller receives it. A value
that fails to convert, or a declared column entirely absent from the
driver's row, SHALL fail fast with an explicit error naming the column,
rather than surfacing as an unconverted value or a silent `undefined`.

#### Scenario: Declared numeric/interval columns arrive converted
- **WHEN** a select resolves a column declared with a numeric width mode
  or as `interval`
- **THEN** the value the caller receives matches that declared mode's
  TypeScript type (not the driver's raw text)

#### Scenario: An unconvertible or missing declared column fails fast
- **WHEN** a declared column's value cannot be converted to its declared
  type, or the declared column is entirely absent from the driver's row
- **THEN** the call rejects with an explicit error naming that column

### Requirement: Array results convert element-wise and arrive in the contracted shape
For an array column whose declared element type carries its own runtime
conversion, the conversion SHALL apply to each element, producing an
array of the declared element shape (a SQL `NULL` element passes through
as `null`, exactly as a `NULL` scalar does). An array column's raw value
that does not match the arrival shape its declared element type's driver
contract promises SHALL be treated as a conversion failure — fail fast
naming the column, never guessed at or coerced into the expected shape.
For a column declared `.notNullElements()`, a `NULL` element arriving at
all SHALL be treated as a conversion failure — the declared element type
excludes `null` because a CHECK enforces it, so an arriving `NULL` means
the constraint no longer holds (e.g. dropped out-of-band) and the
declared type must fail loudly rather than lie silently.

#### Scenario: Array columns arrive converted element-wise
- **WHEN** a select resolves an array column whose element type carries
  a runtime conversion (a moded `bigint`/`numeric` array, or an
  `interval` array)
- **THEN** the caller receives an array whose every non-null element
  has the declared element shape, and every `NULL` element is `null`

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

### Requirement: A failed conversion fails the whole column value
Whether the failure is an unconvertible element, an arrival-shape
mismatch, unparsable array-literal text, or a `NULL` element where the
declaration forbids one, the column's whole value SHALL fail — never a
partial array standing in for it.

#### Scenario: No partial value survives a failed conversion
- **WHEN** one element of an array column's raw value fails to convert
  while the others would succeed
- **THEN** the call rejects naming the column, and no partially
  converted array is delivered
