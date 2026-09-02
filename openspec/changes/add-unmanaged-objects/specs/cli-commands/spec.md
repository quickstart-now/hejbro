# Delta: cli-commands

## ADDED Requirements

### Requirement: check leaves existing declarations alone
`hejbro check` SHALL compare nothing about an existing table — one the
schema declares with `existingTable()` — and SHALL NOT list it in the
unmanaged inventory. That inventory's sense of *unmanaged* is a table no
declaration covers, and an existing declaration covers one: it claims a
shape hejbro does not own. Its presence or absence in the database SHALL
NOT affect the exit code.

#### Scenario: An existing declaration is neither compared nor inventoried
- **WHEN** a schema declares a table with `existingTable()` and `hejbro
  check` runs against a database where that table exists with a
  different shape
- **THEN** no difference is reported for it, it is absent from the
  inventory section, and the exit code is unaffected
