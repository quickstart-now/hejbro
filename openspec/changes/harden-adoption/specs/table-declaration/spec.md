## MODIFIED Requirements

### Requirement: An existing table is declared for its shape, never for its DDL
A table built with `existingTable()` and exported from a schema file
SHALL be accepted as a declaration — *existing* here means declared for
its shape and never managed, not `check`'s inventory sense of a table no
declaration covers. The snapshot SHALL record it as an existing table —
its schema, name, and the columns it was declared with, under an
explicit existing marker — and the generator SHALL emit no statement for
it and SHALL diff nothing against it. Adding, changing, or removing an
existing declaration SHALL produce **no statement**: the run records the
new state in the snapshot and writes a migration carrying no statements
to anchor it in the chain (`cli-commands`), never DDL naming that table.
Everything that reads a
declaration's shape for typing, joins, foreign-key targets, and
expressions SHALL see an existing table exactly as it sees a managed
one; everything that writes DDL SHALL not see it at all. A snapshot
written before this marker existed SHALL read as having every table
managed.

A table changing hands SHALL emit nothing for the table itself; on
adoption the objects hejbro manages on that table — its sequences, its
row-level security, its policies — and the table's own declared
children — its indexes, its checks, its foreign keys and its primary
key — are created, and on handover nothing of theirs is dropped.
Adoption never drops: what the database holds beyond the declaration
is `check`'s inventory. A sequence an adoption creates SHALL be created
idempotently and then altered to its declared type and ownership, so a
sequence a handover left behind is reused and normalized rather than
refused; a table that is new outright keeps the plain create, so a
genuine collision there still fails at apply time.

A validator that judges managed DDL SHALL skip an existing table. An
existing declaration SHALL still reach the validator pipeline exactly as
a managed one does, so a validator that judges a reference rather than
DDL has it to look at.

#### Scenario: An existing declaration produces no statement
- **WHEN** a schema file exports an `existingTable()` and `hejbro
  generate` runs
- **THEN** no statement is written for it — the migration the run writes
  carries none — the snapshot records it as existing with its declared
  columns, and a later run with the declaration changed or removed
  writes no statement for it either

#### Scenario: A managed table may reference an existing one
- **WHEN** a managed table declares a foreign key to an existing
  table's column and `hejbro generate` runs
- **THEN** the managed table's migration carries the foreign key and no
  statement touches the existing table

#### Scenario: A table handed to the platform loses nothing
- **WHEN** a managed table that declares row-level security, a policy
  and a `serial` column is replaced by an `existingTable()` of the same
  identity and `hejbro generate` runs
- **THEN** no statement is written at all — the table is not dropped,
  its sequence is not dropped, its policy is not dropped and its
  row-level security is not disabled — and the snapshot records the
  table as existing

#### Scenario: An adopted table gains what the declaration manages
- **WHEN** a table declared with `existingTable()` is replaced by a
  managed `table()` declaring row-level security, a policy and a
  `serial` column, and `hejbro generate` runs
- **THEN** no `create table` is written; the sequence is created with
  `if not exists` and altered to its declared type and ownership, the
  row-level-security enablement and the policy are created as they are
  for any managed table, and every index, check, foreign key and primary
  key the declaration carries is created — while the same declaration
  handed back to `existingTable()` and adopted again applies cleanly on
  a database that kept the sequence

#### Scenario: A reserved-schema validator exempts an existing table
- **WHEN** a schema declares a table with `existingTable()` in a schema
  the provider preset reserves, and the preset's validator runs
- **THEN** the existing declaration raises no diagnostic, and a managed
  table declared in that same schema is still refused

#### Scenario: An existing declaration reaches the validators
- **WHEN** a schema declaring a table with `existingTable()` is
  generated with a validator installed
- **THEN** that validator is handed the existing declaration among the
  normalized declarations, exactly as it is handed a managed one

#### Scenario: An older snapshot's tables are all managed
- **WHEN** a snapshot written before the existing marker was added is
  read
- **THEN** every table in it is managed
