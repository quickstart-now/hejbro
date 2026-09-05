## ADDED Requirements

### Requirement: generate names what an adoption will create
When a table changes hands from existing to managed, `generate` SHALL
print one diagnostic per adopted table, `adoption-creates`, naming the
objects the migration will create for it — sequences, row-level
security, policies, indexes, checks, foreign keys, primary key — and
ending with a `Next:` line naming `hejbro baseline` for a database that
already holds them. The migration is still written: this is a notice,
not a refusal. A handover, and a table that is new outright, print
nothing under this code.

#### Scenario: Adoption names what it creates
- **WHEN** a declaration replaces `existingTable("widgets")` with a
  managed `table` declaring a `serial` column, row-level security, a
  policy and an index, and `hejbro generate` runs
- **THEN** the run prints `adoption-creates` for `widgets` naming the
  sequence, the row-level security, the policy and the index, with a
  `Next:` naming `hejbro baseline`, and the migration is written

#### Scenario: A handover is silent
- **WHEN** a managed table is replaced by `existingTable()` of the same
  identity and `hejbro generate` runs
- **THEN** nothing is printed under `adoption-creates`
