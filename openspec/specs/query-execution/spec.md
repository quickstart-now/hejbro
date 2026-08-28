# query-execution Specification

## Purpose

Defines the db handle that executes built statements through a driver
and the transaction API, turning compiled SQL plus parameters into typed
rows with predictable error behavior.

## Requirements

### Requirement: A db handle executes built statements
A db handle SHALL be constructed from schema declarations plus a driver
and SHALL execute built statements, returning rows typed by the
statement's inferred result type. What is sent to the database SHALL be
exactly the statement's pure `compile()` output.

#### Scenario: Executed SQL equals previewed SQL
- **WHEN** a statement is compiled for preview and then executed on a db
  handle
- **THEN** the SQL text and parameters the driver receives are identical
  to the previewed compile output, and the resolved rows carry the
  inferred result type

### Requirement: Callback-scoped transactions
The db handle SHALL provide a transaction API that runs a callback's
statements on one connection inside `begin`/`commit`, rolling back when
the callback throws, and requiring the driver's interactive-transaction
capability.

#### Scenario: Commit on success, rollback on throw
- **WHEN** a transaction callback completes normally
- **THEN** its statements are committed atomically
- **WHEN** the callback throws
- **THEN** the transaction is rolled back and the thrown error
  propagates to the caller unchanged

### Requirement: Nested transactions are rejected, not silently flattened
Calling the transaction API **on the db handle** again from inside an
already-open callback of that same member SHALL fail immediately with an
explicit error, before any further statement is sent; the query layer
SHALL NOT silently flatten such a call into the outer transaction (or
open a second, unrelated one). That call would take a second connection
out of the pool rather than nest, so the error SHALL name the `tx`
handle's own transaction API as the way to nest.

#### Scenario: A nested transaction() call on the db handle fails fast
- **WHEN** the db handle's `transaction()` is called again from inside its
  own already-open callback
- **THEN** the inner call rejects with an explicit error identifying the
  condition and naming `tx.transaction(...)` as the supported way to
  nest, its own callback never runs, and no further statement reaches the
  database

### Requirement: Database errors propagate with context
Execution failures reported by the database SHALL surface to the caller
carrying the driver's underlying error as the cause; the query layer
SHALL NOT swallow, retry, or reinterpret them in v1. The thrown error's
message SHALL contain the executed statement's parameterized SQL text
(every value already a bind-parameter placeholder); the statement's own
parameter *values* SHALL NEVER appear anywhere on the thrown error — not
in the message, not as an enumerable field, not in its string or JSON
representation.

#### Scenario: Constraint violation reaches the caller
- **WHEN** an executed insert violates a declared unique constraint
- **THEN** the call rejects with an error exposing the underlying
  database error, and no automatic retry occurs

#### Scenario: Parameter values never reach the thrown error
- **WHEN** an executed, parameterized statement fails
- **THEN** the thrown error's message contains the statement's SQL text
  with bind-parameter placeholders, and the value bound to each
  placeholder appears nowhere on the error — not in the message, not as
  a field, not via the error's string or JSON form

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

### Requirement: Row-conversion internals are not part of the public contract
The primitives that resolve a driver row's per-column conversion plan
(matching a returned column against its declared column state, and
converting one raw row through that plan) are internal to the query
package's own execution pipeline. They SHALL NOT be part of its public
entry surface — exposing them would let a driver or preset couple to
conversion internals that owe no compatibility promise across releases.

#### Scenario: Conversion internals are absent from the public entry surface
- **WHEN** the query package's public entry surface is inspected
- **THEN** it exposes no export for resolving a declared column's
  conversion state, planning a statement's or a result's per-column
  conversion plan, or converting one raw row through such a plan

### Requirement: Nested values are revived to their declared types
Executing a statement with nested reads SHALL deliver every nested
value converted to its column's declared read type, exactly as a
top-level read converts it — `bigint` values past 2^53 arrive intact
as `bigint` (the compiler casts at-risk columns to text inside the
JSON payload; the casts are visible in `compile()`), datetimes arrive
as `Date`, structured values arrive structured. The whole read is one
statement in one round trip — under an RLS execution context it runs
inside that context's single transaction like any other statement,
and no client-side stitching across statements occurs. An empty
collection arrives as `[]`; a missing single row arrives as `null`.

#### Scenario: Precision survives the JSON round trip
- **WHEN** a child row holds a `bigint` column value of
  `9007199254740993n` (past `Number.MAX_SAFE_INTEGER`) and the parent
  is read with a nested collection
- **THEN** the delivered nested value is exactly `9007199254740993n`,
  and the compiled SQL shows the text cast that preserved it

#### Scenario: One statement under the RLS context
- **WHEN** `db.as(ctx).select(posts).related({ comments: true })` runs
- **THEN** exactly one statement executes inside the context's
  transaction, and the nested rows obey the same RLS policies the
  context grants

### Requirement: Set-operation results convert per the left branch
Executing a set-operation statement SHALL deliver rows converted
exactly as a select over the LEFT branch would convert them — declared
keys, numeric modes, intervals, arrays, the whole existing conversion
contract — in one statement and one round trip, under an RLS execution
context exactly like any other statement.

#### Scenario: Converted values arrive through a union
- **WHEN** a union over tables declaring a `bigint` and an `interval`
  column executes against a real database
- **THEN** every delivered row carries `bigint` values as `bigint` and
  interval values structured, exactly as the single-select read does

### Requirement: Nested transactions run on savepoints
The `tx` handle a transaction callback receives SHALL itself provide a
transaction API that nests on the same connection: it SHALL issue a
`SAVEPOINT` before running its callback, `RELEASE SAVEPOINT` on normal
return, and `ROLLBACK TO SAVEPOINT` on a thrown error, rethrowing that
error unchanged. Rolling back a nested transaction SHALL NOT abort the
transaction containing it — the enclosing callback may catch the error
and continue issuing statements, and its own commit SHALL include
everything outside the rolled-back savepoint.

Savepoint names SHALL be generated by the query layer and be distinct
within one transaction, for siblings and nested levels alike; they are
never caller-supplied.

Nesting SHALL NOT require a capability beyond the enclosing
transaction's own: a savepoint is only ever issued inside an already-open
interactive transaction.

#### Scenario: A nested transaction releases into its parent
- **WHEN** a `tx.transaction()` callback returns normally
- **THEN** its statements are released into the enclosing transaction and
  commit with it, on the same connection — no second `BEGIN` is issued

#### Scenario: A rolled-back nested transaction leaves its parent usable
- **WHEN** a `tx.transaction()` callback throws
- **THEN** the statements it issued are rolled back to its savepoint, the
  error is rethrown unchanged, and the enclosing callback can catch it and
  keep issuing statements that still commit

#### Scenario: Sibling and nested savepoints do not collide
- **WHEN** one transaction contains a nested transaction inside another
  nested transaction, followed by a sibling nested transaction
- **THEN** each is bracketed by its own distinct savepoint name, released
  innermost-first
