# Delta: schema-vendoring

## ADDED Requirements

### Requirement: An unmanaged table crosses the boundary
A vendored contract SHALL emit an unmanaged table under `Tables` with
the same `Row`, `Insert`, and `Update` derivation a managed table gets,
and its client metadata SHALL mark it unmanaged. The name-keyed client
SHALL expose it for reading and joining like any other table. A managed
table's foreign key onto an unmanaged table the schema declares SHALL
resolve to a relation; a foreign key onto a table the schema does not
declare at all keeps having none.

#### Scenario: A consumer joins a platform-owned table
- **WHEN** a schema declaring `auth.users` as unmanaged and a managed
  table referencing it is vendored, and the consumer reads the managed
  table with its relation to `auth.users`
- **THEN** the relation resolves and the joined rows type as the
  unmanaged table's declared columns

#### Scenario: An undeclared table still has no relation
- **WHEN** a managed table references a table the schema neither
  manages nor declares unmanaged
- **THEN** the contract carries no relation for that reference, as
  before
