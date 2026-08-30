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

A nested cell SHALL NOT lose that protection by being an aggregate
rather than a plain column: `count()` and a `min`/`max` over an
at-risk column are cast and revived the same way, because JSON has
already lost the precision by the time the value reaches the client
and a wrong value is worse than an unconverted one. `sum`/`avg` are
deliberately outside this: their result type is not the argument's,
so they are neither cast nor converted, and casting them would deliver
text where a number is expected.

The at-risk cast is the compiler's own encoding, and conversion SHALL
undo exactly that: a value arriving through it is revived by the type
of the expression *inside* the cast — whatever that expression is, a
column reference or an aggregate — so a newly castable cell shape does
not also require teaching the reviver a new expression kind. A `::text`
cast a user writes through the `sql` escape hatch SHALL NOT be undone:
an explicit cast is an instruction, and reviving past it would deliver
a `bigint` where its author asked for text.

#### Scenario: Precision survives the JSON round trip
- **WHEN** a child row holds a `bigint` column value of
  `9007199254740993n` (past `Number.MAX_SAFE_INTEGER`) and the parent
  is read with a nested collection
- **THEN** the delivered nested value is exactly `9007199254740993n`,
  and the compiled SQL shows the text cast that preserved it

#### Scenario: An aggregate cell keeps its precision too
- **WHEN** a nested collection projects `count()` or `max()` over a
  `bigint` column whose value is past `Number.MAX_SAFE_INTEGER`
- **THEN** the delivered value is exactly that `bigint`, not a rounded
  number and not the cast's text

#### Scenario: An explicit user cast is left alone
- **WHEN** a nested cell is written as `` sql`${max(posts.views)}::text` ``
- **THEN** the delivered value is the text the cast asked for, not a
  revived `bigint`

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

A callback that throws **synchronously** SHALL be handled identically to
one that rejects: its savepoint is rolled back and the error rethrown
unchanged.

No savepoint SHALL outlive the nested transaction that created it, on
any exit: a rolled-back savepoint SHALL also be released, so a
transaction that nests repeatedly does not accumulate savepoints for its
own lifetime. An enclosing callback may catch the error a nested
transaction raises and carry on, so an exit that ends in a throw is not
exempt.

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
  savepoint is released, the error is rethrown unchanged, and the
  enclosing callback can catch it and keep issuing statements that still
  commit

#### Scenario: A synchronous throw rolls back like a rejection
- **WHEN** a `tx.transaction()` callback throws before returning a
  promise
- **THEN** its savepoint is rolled back and released and the error is
  rethrown unchanged, exactly as for a rejected promise

#### Scenario: Sibling and nested savepoints do not collide
- **WHEN** one transaction contains a nested transaction inside another
  nested transaction, followed by a sibling nested transaction
- **THEN** each is bracketed by its own distinct savepoint name, released
  innermost-first

### Requirement: Concurrent nested transactions are rejected
Savepoints on one connection are strictly nested, so two nested
transactions on the same `tx` cannot be in flight at once: their
savepoint statements interleave, and a `ROLLBACK TO` on the older
savepoint destroys the newer one — discarding already-resolved work with
no error, or aborting the enclosing transaction with a "no such
savepoint" failure, depending on the interleaving.

Starting a nested transaction on a `tx` that already has one in flight
SHALL therefore fail immediately with `concurrent-nested-transaction`,
before any savepoint statement is sent, and its callback SHALL NOT run. The error
SHALL name sequential nesting — awaiting one nested transaction before
starting the next — as what to do instead.

Sequential nesting SHALL stay unaffected: once a nested transaction has
settled, the same `tx` accepts another.

#### Scenario: Concurrent siblings fail fast without data loss
- **WHEN** two nested transactions on the same `tx` are started
  concurrently
- **THEN** the second fails with an explicit coded error, its callback
  never runs, no savepoint statement for it reaches the database, and the
  first sibling's work is unaffected

#### Scenario: Sequential nesting still works
- **WHEN** a nested transaction settles and another is started on the
  same `tx`
- **THEN** it runs normally, on its own distinct savepoint

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

### Requirement: The chain declares CTEs too
The chain surface SHALL offer `with()` as its own root, producing the same
statement node the core builder produces for the same declaration, and
SHALL execute it as one statement.

Result rows SHALL be converted by the body statement's own projection: a
statement wrapped in a `WITH` reads back exactly as the same body would
without one, brands and conversions included.

#### Scenario: A chain-built CTE compiles like the builder's
- **WHEN** the same CTE statement is expressed through the chain and
  through the core builder
- **THEN** the two compile to byte-identical SQL and the same parameter
  order

#### Scenario: Results convert through the wrapper
- **WHEN** a statement declaring a CTE projects a field whose type needs
  conversion
- **THEN** the value arrives converted, as it would in an unwrapped
  statement

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
