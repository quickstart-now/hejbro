# Delta: schema-vendoring

## ADDED Requirements

### Requirement: A database-sourced contract is marked and refused by the checks that need a commit
A contract written by `pull --db-url` SHALL carry an origin that names
the database and no commit, and `vendor --check` and `outdated` SHALL
refuse to run against it with a coded diagnostic naming `link` as the
way to a commit-anchored contract.

#### Scenario: outdated refuses a database-sourced contract
- **WHEN** `hejbro outdated` runs in a repository whose contract came
  from `pull --db-url`
- **THEN** it fails with the coded diagnostic and names `link`
