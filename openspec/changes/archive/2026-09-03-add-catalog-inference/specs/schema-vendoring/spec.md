# Delta: schema-vendoring

## ADDED Requirements

### Requirement: A database-sourced contract is marked and refused by the checks that need a commit
A contract's metadata SHALL name where the contract came from, and the
two sources are told apart there rather than guessed at: one names the
commit it was vendored from, the other names the database it was
inferred from — its name and the schemas that were read, never the
connection string, which carries a secret. A contract written by
`pull --db-url` SHALL carry the second, with no commit, and SHALL say
in its header that it was inferred from a database rather than vendored
from a schema repository. `vendor --check` and `outdated` SHALL refuse
to run against it with a coded diagnostic naming `link` as the way to a
commit-anchored contract. A contract vendored before the origin was
named — carrying a commit and no source — SHALL still type-check
against the client that reads it, so upgrading the client never breaks
a contract already committed.

#### Scenario: pull writes where vendor writes
- **WHEN** `hejbro pull --db-url <db> --schema public` runs in a
  repository that has vendored before
- **THEN** it writes the vendor layout in place, under the same
  existing-file rules `vendor` itself applies, and the lock it leaves
  is marked as written by `pull`

#### Scenario: A database-sourced contract says so and carries no commit
- **WHEN** `hejbro pull --db-url <db> --schema public` writes a contract
- **THEN** its header says it was inferred from a database, its metadata
  names that database and the schemas read, and it carries no commit

#### Scenario: outdated refuses a database-sourced contract
- **WHEN** `hejbro outdated` runs in a repository whose contract came
  from `pull --db-url`
- **THEN** it fails with the coded diagnostic and names `link`
