# Delta: cli-commands

## MODIFIED Requirements

### Requirement: The migration chain on disk is verifiable
The CLI SHALL provide a `verify` command that checks, without a
database, that the migration directory and the snapshot still agree:
every migration's banner hash chain is intact and in order, and the
snapshot's recorded hash matches the parsed-and-re-rendered snapshot —
so a hand-edited snapshot, an edited banner line, or a missing, renamed
or reordered migration file is reported as a mismatch naming the
artifact, and an untouched chain passes. `verify` SHALL accept the chain
a `baseline` starts exactly as one `generate` starts.

The two banner hashes are hashes of the normalized declaration snapshot
before and after the migration, never of the file's own SQL text
(migration-format), so `verify` vouches for the declared history a chain
records, not for the statements a file carries: an edit to a migration's
SQL body that leaves its banner lines intact SHALL pass `verify`
unreported. The limit is stated so that nobody reads a passing `verify`
as proof that applied SQL matches generated SQL. The one body edit
hejbro does catch — a transaction-control statement — is refused at
apply time by `migrate` (migration-apply); detecting other body edits
needs a record of what was applied, which is a separate capability.

#### Scenario: An untouched chain passes
- **WHEN** `hejbro verify` runs over migrations and a snapshot that
  hejbro wrote and nothing edited
- **THEN** it passes with exit code zero

#### Scenario: A hand-edited artifact is reported
- **WHEN** a migration's banner line or the snapshot is edited by hand
  and `hejbro verify` runs
- **THEN** it fails naming the artifact whose hash no longer matches,
  with a non-zero exit code

#### Scenario: A body edit that keeps the banner lines passes
- **WHEN** a migration's SQL body is edited by hand, its banner lines
  left intact, and `hejbro verify` runs
- **THEN** it passes with exit code zero — the chain never hashed the
  body, and this requirement says so rather than implying otherwise
