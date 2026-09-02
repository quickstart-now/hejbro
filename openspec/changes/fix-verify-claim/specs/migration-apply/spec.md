# Delta: migration-apply

## MODIFIED Requirements

### Requirement: Applying refuses a chain that does not verify, and reports what disagrees
The apply path SHALL verify the migration chain on disk before opening a
database connection at all: each hash names the normalized declaration
snapshot before and after that migration — never a file's own SQL bytes,
the same fact `migration-format`'s own requirement states about these
lines — so applying a chain whose hashes do not agree is applying
migrations no snapshot vouches for, and the check needs no database to
make. This is why the chain catches a hash-chain line edited, a file
removed, or the order rearranged, but not a hand-edit to a migration's
own SQL body: the chain was never a witness to that body, so a body edit
is instead what the transaction-control refusal above exists to bound.
The walk starts at the first hashed file and takes that file's own
`parent-snapshot:` as given (cli-commands' `verify` requirement states
the same root rule), so two mutations at the head of the chain are
outside its reach and SHALL NOT be refused: an edit to the first
migration's `parent-snapshot:` line, and the removal of the first
migration itself — the next file becomes the root. Both pass the
pre-flight and the connection is opened as for an intact chain.

It SHALL also report where the chain and the ledger disagree, with each
kind of disagreement carrying its own code and its own `Next:` line: a
ledger row naming a migration the repository does not contain, and a
recorded migration the chain orders after an unrecorded one. Each of
these sends the reader somewhere no other one does, which is why they
are told apart rather than reported as one condition.

#### Scenario: An unverifiable chain opens no connection
- **WHEN** a migration's hash-chain banner line other than the first
  migration's `parent-snapshot:` has been edited, or a migration other
  than the first has been removed, or the order has been rearranged, and
  `migrate` runs
- **THEN** it fails naming the artifact whose hash no longer matches, no
  connection is opened, and no statement is sent to the database

#### Scenario: A mutation at the chain root passes the pre-flight
- **WHEN** the first migration's `parent-snapshot:` line has been edited,
  or the first migration has been removed, and `migrate` runs
- **THEN** the chain pre-flight passes and the run proceeds to open its
  connection exactly as it would for an intact chain

#### Scenario: A ledger row with no file is reported
- **WHEN** the ledger records a migration the repository does not
  contain
- **THEN** it is reported with its own code and a `Next:` line, distinct
  from the code for a migration recorded out of chain order

#### Scenario: A migration recorded out of chain order is reported
- **WHEN** the ledger records a migration the chain orders after one it
  does not record
- **THEN** that is reported with its own code and its own `Next:` line,
  and nothing is applied on top of it
