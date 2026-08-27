# typed-function-execution Specification

## Purpose

Exposes declared database functions as typed callables on the db handle,
so functions defined through `defineFunction` are invoked with checked
arguments and typed results instead of hand-written SQL strings.

## Requirements

### Requirement: Declared functions are typed callables
The db handle SHALL expose every `defineFunction` declaration under
`db.fn` as a callable whose argument types derive from the declared
argument list and whose result type derives from the declared return
shape.

#### Scenario: Scalar function call
- **WHEN** a declared function returning a scalar type is called through
  `db.fn` with matching arguments
- **THEN** the call executes a parameterized invocation of that function
  and resolves to a value of the mapped scalar type

#### Scenario: Returns-table function call
- **WHEN** a declared function returning a table shape is called through
  `db.fn`
- **THEN** the call resolves to typed rows and the rendered SQL lists
  the returned columns explicitly, never `select *`

### Requirement: Argument mismatches fail the type check
Calling a `db.fn` callable with missing, extra, or wrongly typed
arguments SHALL be a TypeScript compile-time error; no runtime coercion
is performed.

#### Scenario: Wrong argument type is rejected statically
- **WHEN** a caller passes a value whose TypeScript type does not match
  the declared argument type
- **THEN** the program fails type-checking and no runtime call path
  exists for the mismatch

### Requirement: Function calls compose with contexts
`db.fn` callables SHALL be available on context-scoped handles and run
under that context like any other statement.

#### Scenario: Function under an RLS context
- **WHEN** a declared function is called on a `db.as(context)` handle
- **THEN** the invocation runs inside the context's transaction with the
  context's role and settings applied
