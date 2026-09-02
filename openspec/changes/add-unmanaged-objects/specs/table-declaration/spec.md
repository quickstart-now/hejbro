# Delta: table-declaration

## ADDED Requirements

### Requirement: An existing table is declared for its shape, never for its DDL
A table built with `existingTable()` and exported from a schema file
SHALL be accepted as a declaration — *existing* here means declared for
its shape and never managed, not `check`'s inventory sense of a table no
declaration covers. The snapshot SHALL record it as an existing table —
its schema, name, and the columns it was declared with, under an
explicit existing marker — and the generator SHALL emit no statement for
it and SHALL diff nothing against it. Adding, changing, or removing an
existing declaration SHALL produce no migration. Everything that reads a
declaration's shape for typing, joins, foreign-key targets, and
expressions SHALL see an existing table exactly as it sees a managed
one; everything that writes DDL SHALL not see it at all. A snapshot
written before this marker existed SHALL read as having every table
managed.

A managed declaration replaced by an existing one, or the reverse,
SHALL emit nothing — the table stands as it is; the reverse is
adoption, and only later changes alter it.

A validator that judges managed DDL SHALL skip an existing table; one
that checks a reference SHALL see it.

#### Scenario: An existing declaration produces no migration
- **WHEN** a schema file exports an `existingTable()` and `hejbro
  generate` runs
- **THEN** no migration is written for it, the snapshot records it as
  existing with its declared columns, and a later run with the
  declaration changed or removed writes no migration either

#### Scenario: A managed table may reference an existing one
- **WHEN** a managed table declares a foreign key to an existing
  table's column and `hejbro generate` runs
- **THEN** the managed table's migration carries the foreign key and no
  statement touches the existing table

#### Scenario: A table changing hands emits nothing
- **WHEN** a table declared with `table()` is replaced by an
  `existingTable()` of the same identity — or an existing declaration
  is replaced by a managed one — and `hejbro generate` runs
- **THEN** no statement is written for that table, neither a drop nor a
  create, and the snapshot records it under its new management

#### Scenario: A reserved-schema validator exempts an existing table
- **WHEN** a schema declares a table with `existingTable()` in a schema
  the provider preset reserves, and the preset's validator runs
- **THEN** the existing declaration raises no diagnostic, and a managed
  table declared in that same schema is still refused

#### Scenario: An older snapshot's tables are all managed
- **WHEN** a snapshot written before the existing marker was added is
  read
- **THEN** every table in it is managed
