# cli-commands (delta)

## REMOVED Requirements

### Removed: The database driver is an optional dependency
**Renamed.** The git channel depends on an external binary as well, and
the requirement now covers both. Its content is re-stated below rather
than changed in place, because a requirement is matched by its title.

## MODIFIED Requirements

### Requirement: Migrations are generated deterministically from declarations
The CLI SHALL provide a `generate` command that diffs the declarations
against the last snapshot and writes exactly two artifacts: the next
migration file (carrying only what changed) and the updated snapshot.
Generation SHALL be deterministic: the same declarations against the
same snapshot SHALL produce byte-identical migration SQL and
byte-identical snapshot bytes, run anywhere, with no database
connection. A run that finds no difference SHALL write nothing, report
"no changes — snapshot already matches your declarations", and exit
zero. `generate`'s flag surface carries the rename flags (identifying a
rename that would otherwise diff as drop-plus-add) and the
drop-confirmation flags (confirming a destructive change by the dropped
object's name); those flags are `generate`'s own, which is why a
baseline refuses them.

Where the export is enabled, generation SHALL also write the export
described by `schema-export`, from the same pass over the declarations,
so that a repository cannot hold a migration and an export that
disagree about what was declared.

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

## ADDED Requirements

### Requirement: An external tool is an optional dependency
Commands that reach outside the process SHALL declare that dependency
nowhere in the package's own dependency list, and SHALL report its
absence as a coded failure naming what to install.

Two such tools exist. Vendoring runs `git`, and a machine without it
SHALL be told so rather than shown a subprocess error. `check` loads a
driver dynamically, and a missing driver SHALL be reported as it
already is.

#### Scenario: A missing driver is explained
- **WHEN** `hejbro check` runs in a project without the driver package
- **THEN** it fails with a hejbro-coded error naming the package to
  install, not a module-resolution stack trace

#### Scenario: A missing git is explained
- **WHEN** a vendoring command runs on a machine with no `git`
- **THEN** it fails with a coded error naming what is missing, not with
  a raw subprocess failure

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
