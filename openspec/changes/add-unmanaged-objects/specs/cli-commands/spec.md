# Delta: cli-commands

## ADDED Requirements

### Requirement: The apply commands leave existing declarations alone
`hejbro check` SHALL compare nothing about an existing table — one the
schema declares with `existingTable()` — and SHALL NOT list it in the
unmanaged inventory. That inventory's sense of *unmanaged* is a table no
declaration covers, and an existing declaration covers one: it claims a
shape hejbro does not own. Its presence or absence in the database SHALL
NOT affect the exit code.

`hejbro reset` SHALL drop nothing of an existing table, `hejbro
baseline` SHALL write no statement for one, and `hejbro raise` SHALL be
unaffected by such a declaration — it reads migration text and the
ledger, never a declaration.

#### Scenario: An existing declaration is neither compared nor inventoried
- **WHEN** a schema declares a table with `existingTable()` and `hejbro
  check` runs against a database where that table exists with a
  different shape
- **THEN** no difference is reported for it, it is absent from the
  inventory section, and the exit code is unaffected

#### Scenario: baseline and reset pass an existing declaration by
- **WHEN** a schema declaring a table with `existingTable()` is
  baselined, and a later `hejbro reset` runs against it
- **THEN** the baseline migration carries no statement for that table,
  and the reset drops nothing of it
