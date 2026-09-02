# Delta: schema-vendoring

## ADDED Requirements

### Requirement: The contract carries a typed function surface
A vendored contract SHALL emit, under its `Functions` section, one entry
per function the export carries an export name for — keyed by that
export name — with the argument object type (the declared TypeScript
keys, each typed as the declared argument type would be read) and the
result type (the mapped scalar type, or the rows of the returned table,
with the same numeric-mode and element-nullability rules the table
entries follow). A function synthesized as part of a trigger definition
carries no export name and SHALL NOT appear. The name-keyed client
built from that contract SHALL expose those functions under `fn`,
keyed the same way, as callables whose rendered SQL is the same
parameterized invocation the declaring repository's own `db.fn` renders
— an explicit column list for a table return, never `select *` — so a
consumer calls the owning repository's functions with the types the
declarations gave them and no declaration in hand.

#### Scenario: A scalar function crosses the boundary
- **WHEN** a schema declaring a scalar-returning function is vendored
  and the consumer calls it through the client's `fn` with matching
  arguments
- **THEN** the call type-checks against the declared argument keys and
  types, executes a parameterized invocation, and resolves to the
  mapped scalar type

#### Scenario: A table-returning function crosses the boundary
- **WHEN** a schema declaring a function that returns a table is
  vendored and called through the client's `fn`
- **THEN** it resolves to that table's typed rows and the rendered SQL
  lists the returned columns explicitly

#### Scenario: A mismatched call fails the type check
- **WHEN** the consumer calls a vendored function with a missing, extra,
  or wrongly typed argument
- **THEN** the call fails to compile

#### Scenario: A synthesized trigger function is absent
- **WHEN** the vendored schema's only functions come from trigger
  definitions
- **THEN** the contract's `Functions` section is empty and the client
  exposes no `fn` entry
