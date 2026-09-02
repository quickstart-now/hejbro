# Delta: table-declaration

## ADDED Requirements

### Requirement: An unmanaged table is declared for its shape, never for its DDL
A table built with `existingTable()` and exported from a schema file
SHALL be accepted as a declaration: the snapshot SHALL record it as an
unmanaged table — its schema, name, and the columns it was declared
with, under an explicit unmanaged marker — and the generator SHALL emit
no statement for it and SHALL diff nothing against it. Adding,
changing, or removing an unmanaged declaration SHALL produce no
migration. Everything that reads a declaration's shape for typing,
joins, foreign-key targets, and expressions SHALL see an unmanaged
table exactly as it sees a managed one; everything that writes DDL
SHALL not see it at all. A snapshot written before this marker existed
SHALL read as having no unmanaged tables.

A managed declaration replaced by an unmanaged one, or the reverse,
SHALL emit nothing — the table stands as it is; the reverse is
adoption, and only later changes alter it.

A validator that judges managed DDL SHALL skip an unmanaged table; one
that checks a reference SHALL see it.

#### Scenario: An unmanaged declaration produces no migration
- **WHEN** a schema file exports an `existingTable()` and `hejbro
  generate` runs
- **THEN** no migration is written for it, the snapshot records it as
  unmanaged with its declared columns, and a later run with the
  declaration changed or removed writes no migration either

#### Scenario: A managed table may reference an unmanaged one
- **WHEN** a managed table declares a foreign key to an unmanaged
  table's column and `hejbro generate` runs
- **THEN** the managed table's migration carries the foreign key and no
  statement touches the unmanaged table

#### Scenario: A table changing hands emits nothing
- **WHEN** a table declared with `table()` is replaced by an
  `existingTable()` of the same identity — or an unmanaged declaration
  is replaced by a managed one — and `hejbro generate` runs
- **THEN** no statement is written for that table, neither a drop nor a
  create, and the snapshot records it under its new management

#### Scenario: A reserved-schema validator exempts an unmanaged table
- **WHEN** a schema declares a table unmanaged in a schema the provider
  preset reserves, and the preset's validator runs
- **THEN** the unmanaged declaration raises no diagnostic, and a managed
  table declared in that same schema is still refused

#### Scenario: An older snapshot has no unmanaged tables
- **WHEN** a snapshot written before the unmanaged marker existed is
  read
- **THEN** every table in it is managed
