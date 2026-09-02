# Delta: schema-vendoring

## ADDED Requirements

### Requirement: An existing table crosses the boundary
A vendored contract SHALL emit an existing table — one the schema
declares with `existingTable()` — under `Tables` with the same `Row`,
`Insert`, and `Update` derivation a managed table gets, and its client
metadata SHALL mark it existing. The name-keyed client SHALL expose it
for reading like any other table, and a managed table's foreign key
onto it SHALL resolve to a relation in the contract exactly as one onto
a managed table does; a foreign key onto a table the schema does not
declare at all keeps having none.

Following that relation from the client is a separate surface: the
name-keyed client exposes no `.related()` for any table, managed or
existing. What this requirement guarantees is that the relation is
carried in the contract.

No code reads that mark today — the client already treats every
vendored table as existing, and whether a relation resolves is decided
when the contract is emitted, not when it is read. The mark is carried
for the reader of the generated file and for tooling built on it.

#### Scenario: A consumer reads a platform-owned table
- **WHEN** a schema declaring `auth.users` with `existingTable()` and a
  managed table referencing it are vendored, and the consumer reads
  both tables through the vendored client
- **THEN** the contract carries the relation to `auth.users`, and rows
  of the existing table read through the client type as its declared
  columns

#### Scenario: An undeclared table still has no relation
- **WHEN** a managed table references a table the schema neither
  manages nor declares with `existingTable()`
- **THEN** the contract carries no relation for that reference, as
  before
