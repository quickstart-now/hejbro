# cli-commands (delta)

## REMOVED Requirements

### Requirement: The database driver is an optional dependency
**Renamed.** The git channel depends on an external binary as well, and
the requirement now covers both. Its content is re-stated below rather
than changed in place, because a requirement is matched by its title.
**D106 correction**: this REMOVED entry's own header must read
`### Requirement: <title>`, exactly the tag ADDED/MODIFIED entries use
— `openspec archive` matches a REMOVED entry against the shipped spec
by that exact header shape, not by a `### Removed:` variant, and a
mismatch here is not an error the tool surfaces: it silently drops zero
requirements. Verified by observation, not assumed (see tasks.md's own
closing note).

## MODIFIED Requirements

### Requirement: Migrations are generated deterministically from declarations
The CLI SHALL provide a `generate` command that diffs the declarations
against the last snapshot and writes exactly two artifacts when the
export is disabled — the next migration file (carrying only what
changed) and the updated snapshot — plus the export directory described
below when it is enabled. Generation SHALL be deterministic: the same
declarations against the same snapshot SHALL produce byte-identical
migration SQL and byte-identical snapshot bytes, run anywhere, with no
database connection. A run that finds no difference SHALL write no
migration and no snapshot, report "no changes — snapshot already
matches your declarations", and exit zero. `generate`'s flag surface
carries the rename flags (identifying a rename that would otherwise
diff as drop-plus-add) and the drop-confirmation flags (confirming a
destructive change by the dropped object's name); those flags are
`generate`'s own, which is why a baseline refuses them.

Where the export is enabled, generation SHALL also write the export
described by `schema-export`, from the same pass over the declarations,
so that a repository cannot hold a migration and an export that
disagree about what was declared. **This SHALL hold even when there is
no difference to write a migration for**: a repository whose snapshot
already matches its declarations has no other run that could ever
produce its first export, so a no-difference run with the export
enabled SHALL still write it (or refresh it, if one already exists).

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

#### Scenario: The export is written by the same run
- **WHEN** generation runs with the export enabled and finds a
  difference
- **THEN** the export is written from the same declarations that
  produced the migration

#### Scenario: A no-difference run still produces a first export
- **WHEN** generation runs with the export enabled, the snapshot already
  matches the declarations, and no export has ever been written
- **THEN** the export is written anyway, from the current declarations

#### Scenario: A no-difference run refreshes an existing export
- **WHEN** generation runs with the export enabled, the snapshot already
  matches the declarations, and an export already exists
- **THEN** the export is rewritten to match the current declarations,
  not left as whatever it previously held

## ADDED Requirements

### Requirement: An external tool is an optional dependency
The vendoring commands and `check` reach outside the process — `git`
and a database driver, respectively — and SHALL declare neither
dependency in the package's own dependency list, reporting its absence
as a coded failure naming what to install instead. (`history`/`restore`
also shell out to `git`, but for reading this repository's own
existing history, never a repository this process doesn't already sit
inside — a missing `git` there is a different, pre-existing situation
this requirement does not cover.)

Two such tools exist in the scope above. Vendoring runs `git`, and a
machine without it SHALL be told so rather than shown a subprocess
error. `check` loads a driver dynamically, and a missing driver SHALL
be reported as it already is.

Once a driver is loaded, `check` SHALL still meet two more failure
shapes distinct from either tool being absent. Failing to reach the
database SHALL be its own failure, distinct from failing to read its
catalog, and SHALL carry the reason the driver gave. A wrong port or a
typo in a URL is the first failure most users will meet, and answering
it with "confirm the connected role can read pg_catalog" sends them to
inspect privileges on a database they never reached. The reason SHALL
survive the driver's own error shape: a driver may report a connection
failure as an aggregate whose own message is empty, and an empty reason
is not a reason.

`check` SHALL NOT require any driver capability. Every statement it
issues is a plain read that a driver must already support to be a
driver at all, so no capability negotiation stands between this command
and a database. This is a constraint on the design, not an observation
about today's drivers: a future comparison that needs session state or
a transaction would be trading this property away, and that trade is
the decision to surface.

#### Scenario: A missing driver is explained
- **WHEN** `hejbro check` runs in a project without the driver package
- **THEN** it fails with a hejbro-coded error naming the package to
  install, not a module-resolution stack trace

#### Scenario: A missing git is explained
- **WHEN** a vendoring command runs on a machine with no `git`
- **THEN** it fails with a coded error naming what is missing, not with
  a raw subprocess failure

#### Scenario: A connection failure is distinct from a catalog failure
- **WHEN** `hejbro check` cannot connect to the database at all (a wrong
  port, a wrong password, a nonexistent database)
- **THEN** it fails with its own connection-failure code, carrying the
  driver's own reason, never the catalog-unreadable code a later read
  would fail with

### Requirement: Configuration asks each command only for what it needs
Three configuration fields exist for repositories that author
migrations: where migrations are written, where the snapshot lives, and
how migration files are named. A command SHALL demand a field only when
it uses it, and SHALL name the missing field before doing any work.

A consuming repository authors no migrations and SHALL need none of the
three. The commands that acquire and check a vendored schema SHALL read
their source and their lock, and nothing else.

#### Scenario: Each command that needs a field names it
- **WHEN** a command that writes migrations runs without the field
  naming their directory
- **THEN** it fails naming that field, before reading anything else

#### Scenario: A consuming repository needs none of them
- **WHEN** `link`, `vendor` or `outdated` runs in a repository whose
  configuration sets none of the three
- **THEN** the command proceeds

#### Scenario: A field a command does not need is never demanded
- **WHEN** a command that does not write migrations runs
- **THEN** it does not fail for a missing migration-authoring field
