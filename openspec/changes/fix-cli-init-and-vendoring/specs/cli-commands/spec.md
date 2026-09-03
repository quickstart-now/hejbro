## ADDED Requirements

### Requirement: init scaffolds what is missing, where the configuration says
`hejbro init` SHALL create the three artifacts a migration-authoring
repository starts from — `hejbro.config.ts`, the migrations directory,
and an empty snapshot file — creating only the ones that are absent. An
artifact already on disk SHALL be left byte-untouched and reported as
skipped, so the command doubles as a repair of a partially present
project.

Where the last two go SHALL come from the repository's own
configuration when it has one: `init` SHALL read `hejbro.config.ts` and
place the migrations directory and the snapshot file at its
`migrationsDir` and `snapshotPath`, resolved exactly as the commands
that consume those fields resolve them, so `init` cannot create a
directory `generate` will not read. A field the configuration omits, and
a project with no configuration file at all, SHALL fall back to the
values the scaffolded configuration itself carries. Every report line
SHALL name the path acted on, never the default the command would
otherwise have used.

A configuration file that exists but cannot be read — an import that
does not resolve, a shape that does not validate — SHALL stop the run
before any artifact is created, failing with the same coded diagnostic
any other command raises for that file. `init` SHALL NOT fall back to
the default locations for a repository whose configuration it could not
read: that would scaffold a second project beside the real one.

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

#### Scenario: A configuration that names neither field falls back
- **WHEN** `hejbro init` runs with a configuration that sets neither the
  migrations directory nor the snapshot path
- **THEN** both are created at the default locations, the configuration
  file itself is reported as skipped, and the run exits 0

#### Scenario: Only the absent piece is created
- **WHEN** `hejbro init` runs in a repository whose configured
  migrations directory already exists and whose configured snapshot file
  does not
- **THEN** only the snapshot file is created, the directory is reported
  as skipped by its configured path and left untouched, and the run
  exits 0

#### Scenario: A configuration that cannot be read stops the run
- **WHEN** `hejbro init` runs beside a `hejbro.config.ts` whose import
  does not resolve, or whose exported value does not match the
  configuration shape
- **THEN** the run fails with that file's own coded diagnostic and
  neither the migrations directory nor the snapshot file is created
