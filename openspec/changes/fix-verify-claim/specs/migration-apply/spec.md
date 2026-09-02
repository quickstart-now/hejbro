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
The pre-flight is the chain walk alone — each file's `parent-snapshot:`
against the previous file's `snapshot:` — and nothing else: the apply
path reads no snapshot file, so `verify`'s tip check (the last
migration's `snapshot:` against the on-disk snapshot) is not part of it.
That leaves both ends of the chain outside its reach, and the following
SHALL NOT be refused: at the head, an edit to the first migration's
`parent-snapshot:` line (the root is taken as given, the same rule
cli-commands' `verify` states) and the removal of the first migration or
of any leading run of migrations; at the tail, an edit to the last
migration's `snapshot:` line and the removal of the last migration or
of any trailing run. Each passes the pre-flight and the connection is
opened as for an intact chain; `verify` is the command that sees the
tail cases, through the snapshot.

It SHALL also report where the chain and the ledger disagree, with each
kind of disagreement carrying its own code and its own `Next:` line: a
ledger row naming a migration the repository does not contain, and a
recorded migration the chain orders after an unrecorded one. Each of
these sends the reader somewhere no other one does, which is why they
are told apart rather than reported as one condition.

#### Scenario: An unverifiable chain opens no connection
- **WHEN** a hash-chain banner line other than the first migration's
  `parent-snapshot:` and the last migration's `snapshot:` has been
  edited, or a migration between the first and the last has been
  removed, or the order has been rearranged, and `migrate` runs
- **THEN** it fails naming the artifact whose hash no longer matches, no
  connection is opened, and no statement is sent to the database

#### Scenario: A mutation at either end of the chain passes the pre-flight
- **WHEN** the first migration's `parent-snapshot:` line or the last
  migration's `snapshot:` line has been edited, or the first or the last
  migration has been removed, and `migrate` runs
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
