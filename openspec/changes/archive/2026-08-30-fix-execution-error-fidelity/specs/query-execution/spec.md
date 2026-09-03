# query-execution (delta)

## MODIFIED Requirements

### Requirement: Database errors propagate with context
Execution failures reported by the database SHALL surface to the caller
carrying the driver's underlying error as the cause; the query layer
SHALL NOT swallow, retry, or reinterpret them in v1. The thrown error's
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
