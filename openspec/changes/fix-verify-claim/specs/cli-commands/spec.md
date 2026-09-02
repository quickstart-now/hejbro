# Delta: cli-commands

## MODIFIED Requirements

### Requirement: The migration chain on disk is verifiable
The CLI SHALL provide a `verify` command that checks, without a
database, that the migration directory and the snapshot still agree:
every migration's banner hash chain is intact and in order, and the
snapshot's recorded hash matches the parsed-and-re-rendered snapshot —
so a hand-edited snapshot, an edited `parent-snapshot:` or `snapshot:`
hash line (other than the first migration's own `parent-snapshot:`,
which is the chain root and is taken as given), a migration missing
from anywhere but the start of the chain, or a migration whose order
changed is reported as a mismatch, and an untouched chain passes.
`verify` SHALL accept the chain a `baseline` starts exactly as one
`generate` starts.

The two hash lines are hashes of the normalized declaration snapshot
before and after the migration, never of the file's own SQL text
(migration-format), and the chain is checked link by link from its
first hashed file onward. `verify` therefore vouches for the recorded
sequence of declared states, and for nothing else about a file: an edit
to a migration's SQL body that leaves its hash lines intact SHALL pass
`verify` unreported, as SHALL an edit to any other banner line (the
summary lines, the `hejbro:` version line), a rename that keeps a file's
sort position (no hash covers the filename), and the removal of the
first migration (the next file's own `parent-snapshot:` becomes the root
and is taken as given). The limit is stated so that nobody reads a
passing `verify` as proof that applied SQL matches generated SQL. The
one body edit hejbro does catch — a transaction-control statement — is
refused at apply time (migration-apply); detecting other body edits
needs a record of what was applied, which is a separate capability.

#### Scenario: An untouched chain passes
- **WHEN** `hejbro verify` runs over migrations and a snapshot that
  hejbro wrote and nothing edited
- **THEN** it passes with exit code zero

#### Scenario: A hand-edited artifact is reported
- **WHEN** a migration's `parent-snapshot:` or `snapshot:` hash line —
  other than the first migration's `parent-snapshot:` — or the snapshot
  file is edited by hand, and `hejbro verify` runs
- **THEN** it fails with a non-zero exit code, naming the artifact when
  the failing check knows one

#### Scenario: A body edit that keeps the hash lines passes
- **WHEN** a migration's SQL body is edited by hand, its hash lines left
  intact, and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: Removing the first migration passes
- **WHEN** the first migration of a chain is deleted and `hejbro verify`
  runs
- **THEN** it passes with exit code zero, because the next file's
  `parent-snapshot:` is now the chain root and the root is taken as given
