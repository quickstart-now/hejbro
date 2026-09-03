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
sequence of declared states, and not for the files around it. Mutations
outside its reach include — this list names the measured ones, not
every possible one — an edit to a migration's SQL body that leaves its
hash lines intact, an edit to any other banner line (the summary lines,
the `hejbro:` version line), a rename that keeps a file's sort position
(no hash covers the filename), the removal of the first migration or of
any leading run of migrations up to and including all of them (whatever
file is first is the root, and its `parent-snapshot:` is taken as given;
an empty directory has no tip to compare), and a file added with no
hash lines at all (the walk skips it,
though `verify`'s summary line still counts it among the migrations).
Each of these SHALL pass `verify` unreported. The limit is stated so
that nobody reads a passing `verify` as proof that applied SQL matches
generated SQL. The
one body edit hejbro does catch — a transaction-control statement — is
refused at apply time (migration-apply); detecting other body edits
needs a record of what was applied, which is a separate capability.

`verify` SHALL also run every validator a registered preset provides —
the same check `generate` runs before writing anything — over the
declarations against the snapshot its own snapshot-parity check already
builds, and SHALL refuse with the identical coded error `generate` would
raise for the same declaration, so a declaration `generate` refuses
never passes `verify` silently. Where the active configuration registers
no preset validator — including a configuration with no preset at all —
this check does not run at all, and `verify`'s report is unaffected by
its existence.

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

#### Scenario: Removing a leading run of migrations passes
- **WHEN** the first migration of a chain, or every migration, is deleted
  and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: A rename that keeps a file's position passes
- **WHEN** a migration file is renamed without changing its sort position
  and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: A file with no hash lines is skipped but counted
- **WHEN** a file with no banner hash lines is added to the migrations
  directory and `hejbro verify` runs
- **THEN** it passes with exit code zero, and the summary line counts the
  added file among the migrations

#### Scenario: A tip mismatch names the artifacts that disagree
- **WHEN** the last migration's `snapshot:` hash and the on-disk
  snapshot's own hash differ
- **THEN** the report names that migration file and the snapshot path,
  and states the observation only — never a cause

#### Scenario: A preset-refused declaration is refused by verify too
- **WHEN** a registered preset's validator would refuse a declaration at
  `hejbro generate` time, and `hejbro verify` runs against the same
  declarations and its checked-in snapshot
- **THEN** `verify` fails with the identical coded error `generate`
  would raise for that declaration

#### Scenario: A configuration with no preset runs unaffected
- **WHEN** the active configuration registers no preset validator — no
  preset at all, or a preset that provides kinds but no validator — and
  `hejbro verify` runs on declarations that pass every other check
- **THEN** it passes exactly as it would without this capability
  existing, and its report never mentions a preset-validator check
