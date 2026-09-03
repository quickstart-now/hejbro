## ADDED Requirements

### Requirement: init scaffolds what is missing, where the configuration says
`hejbro init` SHALL create the three artifacts a migration-authoring
repository starts from — `hejbro.config.ts`, the migrations directory,
and an empty snapshot file — creating only the ones that are absent. An
artifact already on disk SHALL be left byte-untouched and reported as
skipped, so the command doubles as a repair of a partially present
project whose configuration it can read.

An artifact is present only when what sits at its path is the kind of
thing it names: a directory for the migrations directory, a file for the
snapshot and the configuration. A path holding the other kind SHALL stop
the run with a coded failure naming that path and the kind expected
there, creating nothing — reporting it as present would tell a repair
run that a broken project is whole, and replacing it would be the
overwrite this command never does. A path a configuration spells as a
directory SHALL be refused the same way when the artifact is a file:
the commands that read that file resolve the same spelling and look
inside a directory that cannot hold it, so creating anything for such a
value would produce a file none of them reads.

Where the last two go SHALL come from the repository's own
configuration when it has one: `init` SHALL read `hejbro.config.ts` and
place the migrations directory and the snapshot file at its
`migrationsDir` and `snapshotPath`, resolved exactly as the commands
that consume those fields resolve them, so `init` cannot create a
directory `generate` will not read. A configuration that omits one of
those fields SHALL get no artifact for it, reported as not configured:
the commands that write migrations refuse without that field, so a
directory created for it would be one nothing reads, and a repository
that vendors a schema rather than authoring one SHALL NOT acquire
migration artifacts by running `init`. Only a project with no
configuration file at all falls back to defaults — there `init` writes
the configuration itself, and that file names both fields. Every report
line SHALL name the path acted on, never the default the command would
otherwise have used.

A configuration file that exists but cannot be read — an import that
does not resolve, a shape that does not validate — SHALL stop the run
before any artifact is created, failing with the same coded diagnostic
any other command raises for that file. `init` SHALL NOT fall back to
the default locations for a repository whose configuration it could not
read: that would scaffold a second project beside the real one. This is
the same refusal every other command makes for that file — scaffolding a
configuration does not install the toolchain it imports, so a project
that cannot resolve its own imports gets the same answer from `init` as
from `generate`.

#### Scenario: An empty project is scaffolded
- **WHEN** `hejbro init` runs in a directory with no `hejbro.config.ts`
- **THEN** it writes the configuration, the default migrations directory
  and an empty snapshot file, reports each as created, and exits 0

#### Scenario: A configured location is honoured
- **WHEN** `hejbro init` runs in a repository whose configuration names
  a migrations directory and a snapshot file under a nested directory,
  neither of which exists
- **THEN** both are created at those configured paths, nothing is
  created at the default paths, and each report line names the
  configured path

#### Scenario: A configuration that names neither field gets neither artifact
- **WHEN** `hejbro init` runs with a configuration that sets neither the
  migrations directory nor the snapshot path
- **THEN** neither is created, each is reported as not configured, the
  configuration file itself is reported as skipped, and the run exits 0

#### Scenario: Only the absent piece is created
- **WHEN** `hejbro init` runs in a repository whose configured
  migrations directory already exists and whose configured snapshot file
  does not
- **THEN** only the snapshot file is created, the directory is reported
  as skipped by its configured path and left untouched, and the run
  exits 0

#### Scenario: A path holding the wrong kind of node stops the run
- **WHEN** `hejbro init` runs where the configured snapshot path holds a
  directory, or the configured migrations directory holds a file
- **THEN** the run fails naming that path and the kind expected there,
  nothing is created, and the run does not report the artifact as
  already present

#### Scenario: A configuration that cannot be read stops the run
- **WHEN** `hejbro init` runs beside a `hejbro.config.ts` whose import
  does not resolve, or whose exported value does not match the
  configuration shape
- **THEN** the run fails with that file's own coded diagnostic and
  neither the migrations directory nor the snapshot file is created
