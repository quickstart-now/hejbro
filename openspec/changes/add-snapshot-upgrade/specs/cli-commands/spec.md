## ADDED Requirements

### Requirement: upgrade re-encodes the snapshot and re-chains the tip
`hejbro upgrade` SHALL move a project whose committed snapshot is in an
older released format forward without a reset: it rewrites the snapshot
file in the current format and rewrites the tip migration's own
snapshot-hash banner line to the new file's hash, recording the hash the
tip first recorded on an `upgraded-from` banner line directly under it —
one line, kept across any later upgrade — so that
`verify` accepts the chain afterwards and the next generated migration
chains onto the new hash. Before writing anything it SHALL check that
the tip's recorded hash matches the snapshot as stored, and refuse with
`chain-tip-mismatch` otherwise — an already-broken chain is `verify`'s
business, and upgrading over it would hide the break. With no migration
files there is no tip, and the snapshot alone is rewritten. A snapshot
already in the current format is left untouched with exit 0 and a line
saying so. A newer-format snapshot, and one older than any release, are
refused with the older-format or newer-format diagnostic. Whenever any
command refuses because the snapshot it read is in an older released
format, that refusal SHALL name this command as its next step, and
`generate` and `verify` SHALL be among the commands that so refuse — a
command that never reads the snapshot's contents is not made to fail by
this rule, since a user cut off from the diagnostics is a user who
cannot see what the upgrade is for. The command reads only the snapshot
path and the migrations directory from the configuration.

#### Scenario: An older snapshot is upgraded and the chain verifies
- **WHEN** a project carries a format-5 snapshot and a migration chain
  whose tip pins it, and `hejbro upgrade` runs
- **THEN** the snapshot file is rewritten at format 8, the tip's
  snapshot-hash line names the new file's hash, the `upgraded-from`
  line names the hash the tip carried before, no other line of any
  migration changes, the output names both files, and `hejbro verify`
  then passes

#### Scenario: The next migration chains onto the upgraded snapshot
- **WHEN** a declaration changes after an upgrade and `hejbro generate`
  runs
- **THEN** the new migration's parent hash is the upgraded snapshot's
  hash, and `hejbro verify` accepts the chain

#### Scenario: A broken tip is refused, nothing written
- **WHEN** the tip's recorded hash does not match the snapshot as
  stored and `hejbro upgrade` runs
- **THEN** it fails with `chain-tip-mismatch`, and neither the snapshot
  nor any migration file is modified

#### Scenario: A current-format snapshot is a no-op
- **WHEN** `hejbro upgrade` runs on a project whose snapshot is already
  at format 8
- **THEN** it exits 0, prints that the snapshot is already current, and
  modifies no file

#### Scenario: A project without migrations upgrades the snapshot alone
- **WHEN** a project carries a format-5 snapshot and no migration files
- **THEN** `hejbro upgrade` rewrites the snapshot at format 8 and
  reports no re-chaining

#### Scenario: Other commands point at the upgrade
- **WHEN** `hejbro generate` and `hejbro verify` each meet a format-5
  snapshot
- **THEN** each fails with the older-format diagnostic whose next step
  names `hejbro upgrade`, and neither modifies a file

#### Scenario: A command that never reads the snapshot is unaffected
- **WHEN** `hejbro history` runs against a project whose snapshot is in
  an older released format
- **THEN** it reports the migrations' states as it always does, because
  it resolves them from the migration files and the repository's own
  history rather than from the snapshot's contents

#### Scenario: history and restore still resolve the upgraded tip
- **WHEN** an upgraded tip's snapshot and banner are committed, and
  `hejbro history` and `hejbro restore` run against that migration
- **THEN** `history` reports the tip `ok` at the commit that originally
  added it, and `restore` verifies that commit's declarations against
  the tip's current hash and restores them
