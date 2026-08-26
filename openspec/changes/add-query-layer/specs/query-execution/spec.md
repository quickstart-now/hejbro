# Delta: query-execution

## Purpose

Defines the db handle that executes built statements through a driver
and the transaction API, turning compiled SQL plus parameters into typed
rows with predictable error behavior.

## ADDED Requirements

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
Calling the transaction API again from inside an already-open callback
of that same member SHALL fail immediately with an explicit error,
before any further statement is sent; the query layer SHALL NOT
silently flatten a nested call into the outer transaction (or open a
second, unrelated one).

#### Scenario: A nested transaction() call fails fast
- **WHEN** `transaction()` is called again from inside its own
  already-open callback
- **THEN** the inner call rejects with an explicit error identifying
  the condition, its own callback never runs, and no further statement
  reaches the database

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
to that declared TypeScript shape before the caller receives it; a
value that fails to convert, or a declared column entirely absent from
the driver's row, SHALL fail fast with an explicit error naming the
column, rather than surfacing as an unconverted value or a silent
`undefined`.

#### Scenario: Declared numeric/interval columns arrive converted
- **WHEN** a select resolves a column declared with a numeric width mode
  or as `interval`
- **THEN** the value the caller receives matches that declared mode's
  TypeScript type (not the driver's raw text)

#### Scenario: An unconvertible or missing declared column fails fast
- **WHEN** a declared column's value cannot be converted to its declared
  type, or is entirely absent from the driver's row
- **THEN** the call rejects with an explicit error naming that column
