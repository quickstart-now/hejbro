# cli-commands (delta)

## MODIFIED Requirements

### Requirement: Migrations are generated deterministically from declarations
The CLI SHALL provide a `generate` command that diffs the declarations
against the last snapshot and writes exactly two artifacts: the next
migration file (carrying what changed, and — where schema-manifest
emission is enabled — the manifest statements that record the resulting
schema) and the updated snapshot. Generation SHALL be deterministic: the
same declarations against the same snapshot SHALL produce byte-identical
migration SQL and byte-identical snapshot bytes, run anywhere, with no
database connection; enabling manifest emission SHALL NOT weaken that
property. A run that finds no difference SHALL write nothing, report
"no changes — snapshot already matches your declarations", and exit
zero. `generate`'s flag surface carries the rename flags (identifying a
rename that would otherwise diff as drop-plus-add) and the
drop-confirmation flags (confirming a destructive change by the dropped
object's name); those flags are `generate`'s own, which is why a
baseline refuses them.

#### Scenario: Only the difference is emitted
- **WHEN** one column is added to an already-snapshotted declaration and
  `hejbro generate` runs
- **THEN** the new migration contains the `alter table … add column`
  for that column and nothing else, and the snapshot is updated

#### Scenario: Generation is deterministic
- **WHEN** `hejbro generate` runs twice from the same declarations and
  the same prior snapshot (the first run's outputs discarded)
- **THEN** both runs produce byte-identical migration SQL and
  byte-identical snapshot bytes

#### Scenario: No difference writes nothing
- **WHEN** `hejbro generate` runs and the snapshot already matches the
  declarations
- **THEN** no migration and no snapshot are written, the no-change line
  is reported, and the exit code is zero

#### Scenario: Manifest statements ride with the difference
- **WHEN** one column is added and `hejbro generate` runs with manifest
  emission enabled
- **THEN** the new migration contains the `alter table … add column`
  followed by the manifest statements, and nothing else

### Requirement: The database driver is an optional dependency
`check` and `sync` SHALL acquire their driver dynamically and SHALL NOT
make any database driver a hard runtime dependency of the CLI: every
other command works without one, and installing hejbro must not pull in
a driver for commands that never connect.

When the driver is absent, a connecting command SHALL fail with a
hejbro-coded diagnostic naming the package to install — never a raw
module-resolution error.

Failing to reach the database SHALL be its own failure, distinct from
failing to read its catalog, and SHALL carry the reason the driver gave.
A wrong port or a typo in a URL is the first failure most users will
meet, and answering it with "confirm the connected role can read
pg_catalog" sends them to inspect privileges on a database they never
reached. The reason SHALL survive the driver's own error shape: a driver
may report a connection failure as an aggregate whose own message is
empty, and an empty reason is not a reason.

`check` and `sync` SHALL NOT require any driver capability. Every
statement either issues is a plain read that a driver must already
support to be a driver at all, so no capability negotiation stands
between these commands and a database. This is a constraint on the
design, not an observation about today's drivers: a future comparison
that needs session state or a transaction would be trading this property
away, and that trade is the decision to surface.

#### Scenario: A missing driver is explained
- **WHEN** `hejbro check` runs in a project without the driver package
- **THEN** it fails with a hejbro-coded error naming the package to
  install, not a module-resolution stack trace

#### Scenario: A missing driver is explained for the syncing command too
- **WHEN** `hejbro sync` runs in a project without the driver package
- **THEN** it fails with the same hejbro-coded error naming the package
  to install

## ADDED Requirements

### Requirement: Configuration asks each command only for what it needs
Three configuration fields serve only a repository that holds migration
authority — the migrations directory, the snapshot path, and the
migration file name prefix strategy — and SHALL be optional. A command
that needs one and does not find it SHALL refuse with a coded error
naming the field, and the refusal SHALL happen before the command does
any work, so that a missing field is never discovered halfway through an
operation.

Which command needs which field is fixed and complete: `generate` and
`baseline` need all three; `verify` needs all three; `history` and
`restore` need the migrations directory and the snapshot path; `check`
needs the snapshot path, and the migrations directory only on the path
where no snapshot exists yet; `sync` and `init` need none of the three.

A repository that only reads a schema from a database SHALL NOT be
required to declare where it would write migrations it will never write.

#### Scenario: Each command that needs a field names it
- **WHEN** each of `generate`, `baseline`, `verify`, `history`,
  `restore` and `check` runs with a configuration omitting a field that
  command needs
- **THEN** each fails with a coded error naming that field, before
  reading any declaration or migration

#### Scenario: A consuming repository needs none of them
- **WHEN** `hejbro sync` runs with a configuration that omits the
  migrations directory, the snapshot path and the prefix strategy
- **THEN** it proceeds without error

#### Scenario: A field a command does not need is never demanded
- **WHEN** `hejbro check` runs against an existing snapshot with the
  prefix strategy omitted
- **THEN** it proceeds without error
