# Delta: cli-commands

## ADDED Requirements

### Requirement: check leaves unmanaged declarations alone
`hejbro check` SHALL compare nothing about an unmanaged table and SHALL
NOT list it in the unmanaged inventory: it is declared, and the
declaration claims a shape hejbro does not own. Its presence or absence
in the database SHALL NOT affect the exit code.

#### Scenario: An unmanaged declaration is neither compared nor inventoried
- **WHEN** a schema declares a table unmanaged and `hejbro check` runs
  against a database where that table exists with a different shape
- **THEN** no difference is reported for it, it is absent from the
  inventory section, and the exit code is unaffected
