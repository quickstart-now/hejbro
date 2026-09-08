## ADDED Requirements

### Requirement: generate names what an adoption will create
When a table changes hands from existing to managed, `generate` SHALL
print one diagnostic per adopted table that the migration creates
anything for, `adoption-creates`, naming the objects the migration will
create for it — sequences, row-level security, policies, indexes,
checks, foreign keys, primary key. A table with nothing to create is
adopted silently. The diagnostic also states that apply fails if the
database lacks a column one of these objects needs, and that `hejbro
check --url <url>` names such a column beforehand, ending with a
`Next:` line naming, for a database that already holds these objects,
the two ways that run on it — handing the table back by restoring the
migration, the snapshot and the declaration this run changed, or
dropping the held indexes, checks, foreign keys and primary key, never
the sequence, before applying — and adding the missing column in a
following edit for a database that lacks one. The migration is still
written: this is a notice, not a refusal. A handover, and a table that
is new outright, print nothing under this code.

#### Scenario: Adoption names what it creates
- **WHEN** a declaration replaces `existingTable("app", "widgets", …)`
  with a managed `table` declaring a `serial` column, row-level
  security, a policy and an index, and `hejbro generate` runs
- **THEN** the run prints `adoption-creates` for `widgets` naming the
  sequence, the row-level security, the policy and the index, with the
  missing-column risk sentence and a `Next:` naming both ways through
  for a database that already holds these objects and adding a missing
  column in a following edit, and the migration is written

#### Scenario: A handover is silent
- **WHEN** a managed table is replaced by `existingTable()` of the same
  identity and `hejbro generate` runs
- **THEN** nothing is printed under `adoption-creates`

#### Scenario: An adoption with nothing to create is silent
- **WHEN** a declaration replaces `existingTable()` with a managed
  `table()` of the same identity that declares no sequence, no
  row-level security, no policy and no index, check, foreign key or
  primary key, and `hejbro generate` runs
- **THEN** nothing is printed under `adoption-creates` for that table
