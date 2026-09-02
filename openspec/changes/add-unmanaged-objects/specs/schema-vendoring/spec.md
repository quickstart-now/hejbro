# Delta: schema-vendoring

## ADDED Requirements

### Requirement: An existing table crosses the boundary
A vendored contract SHALL emit an existing table — one the schema
declares with `existingTable()` — under `Tables` with the same `Row`,
`Insert`, and `Update` derivation a managed table gets, and its client
metadata SHALL mark it existing. The name-keyed client SHALL expose it
for reading and joining like any other table. A managed table's foreign
key onto an existing table the schema declares SHALL resolve to a
relation; a foreign key onto a table the schema does not declare at all
keeps having none.

No code reads that mark today — the client already treats every
vendored table as existing, and whether a relation resolves is decided
when the contract is emitted, not when it is read. The mark is carried
for the reader of the generated file and for tooling built on it.

#### Scenario: A consumer joins a platform-owned table
- **WHEN** a schema declaring `auth.users` with `existingTable()` and a
  managed table referencing it are vendored, and the consumer reads the
  managed table with its relation to `auth.users`
- **THEN** the relation resolves and the joined rows type as the
  existing table's declared columns

#### Scenario: An undeclared table still has no relation
- **WHEN** a managed table references a table the schema neither
  manages nor declares with `existingTable()`
- **THEN** the contract carries no relation for that reference, as
  before
