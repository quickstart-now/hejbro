## ADDED Requirements

### Requirement: A configured artifact path is relative to the working directory
`migrationsDir` and `snapshotPath` in `hejbro.config.ts` SHALL be read
as paths relative to the working directory the command runs in — the
one place every command that consumes them resolves them from. A value
spelled as an absolute path (`"/db/migrations"`) SHALL be refused when
the configuration is read, by every command that reads it, with the
error code `invalid-config` naming the field and stating that the field
is relative to the working directory. Refusing is the only honest
answer: the commands resolve such a value by joining it under the
working directory, so honouring it would mean silently re-rooting a
path the user spelled as absolute, and one command reporting the
spelling while another reports the joined location is exactly the
disagreement this rule ends. A relative value SHALL be honoured as
spelled, including a leading `./`, a trailing separator, and a `..`
that leaves the working directory.

#### Scenario: An absolute-looking configured path is refused by every command
- **WHEN** a configuration sets `migrationsDir` or `snapshotPath` to a
  value that begins with a path separator, and `hejbro init`,
  `hejbro generate` or any other command that reads the configuration
  runs
- **THEN** it fails with the error code `invalid-config` naming that
  field, before any artifact is read or written

#### Scenario: A relative configured path is honoured as spelled
- **WHEN** a configuration sets `migrationsDir` to `"./db/migrations"`,
  `"db/migrations/"` or `"../out/migrations"` and `hejbro init` runs
- **THEN** the directory is created at that path under the working
  directory, and the run does not refuse the spelling

### Requirement: A snapshot that cannot be read as a file is refused before it is read
Every command that reads the snapshot file — `generate`, `baseline`,
`verify`, `check` — SHALL check what sits at the configured snapshot
path before reading it. A directory there SHALL stop the run with the
error code `snapshot-not-a-file`, naming the configured path and the
kind expected there, with a `Next:` that names the way back to a
snapshot file. A file there that the process cannot read SHALL stop the
run with the error code `snapshot-unreadable`, naming the configured
path and the operating system's own code, with a `Next:` naming the
permissions to check. The kind is decided first: a directory is refused
as a directory even when it could not have been read, and only a
regular file whose read fails is refused as unreadable. A snapshot
whose path cannot even be inspected — a directory on the way refuses
the look-up — SHALL be refused as unreadable too, naming the operating
system's own code, and its `Next:` SHALL name the directory that blocks
the look-up, decided exactly as `init` decides it: the deepest ancestor
the run could still inspect. Neither SHALL surface as a raw read
failure, and neither message SHALL carry an absolute path. The commands that consume
the snapshot resolve the same path `init` scaffolds, so a directory
there is a project `init` would refuse to create; the read side SHALL
say so in the same terms rather than fail inside a read that was never
going to succeed.

#### Scenario: A directory at the snapshot path is refused with its own code
- **WHEN** a directory sits at the configured `snapshotPath` and
  `hejbro generate` or `hejbro verify` runs
- **THEN** it fails with the error code `snapshot-not-a-file` naming
  that path and a `Next:` line, before any migration is read or
  written, and no raw filesystem error reaches the output

#### Scenario: A snapshot file the process cannot read is refused with its own code
- **WHEN** a regular file sits at the configured `snapshotPath` with no
  read permission for the process, and `hejbro generate`, `hejbro
  baseline`, `hejbro verify` or `hejbro check` runs
- **THEN** it fails with the error code `snapshot-unreadable` naming
  that path and the operating system's own code, with a `Next:` line,
  before any migration is read or written, and no raw filesystem error
  and no absolute path reaches the output

#### Scenario: A snapshot path that cannot be inspected names the directory that blocks it
- **WHEN** the configured `snapshotPath` is `parent/state.json`, the
  directory `parent` exists with no permission to look inside it, and
  `hejbro generate` runs
- **THEN** it fails with the error code `snapshot-unreadable` naming
  the configured path and the operating system's own code, and its
  `Next:` line names `parent` — the same directory `hejbro init` would
  name for the same tree

## MODIFIED Requirements

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
overwrite this command never does. A symbolic link at such a path is
judged by what it points at: a link to a node of the expected kind is
that node, present and left untouched; a link whose target does not
exist is neither kind, and SHALL be refused the same way, naming the
path and the target the link points at — writing through it would
create the artifact somewhere the report never named, and reporting it
as absent would be the same lie one step later. A link that sits where
an artifact would have to be created inside SHALL be judged the same
way. The same refusal SHALL cover a path
an artifact would have to be created inside, and a configuration that
names one path for two artifacts: neither can be satisfied, and one of
them would otherwise be reported as already present. It SHALL equally
cover a configuration whose planned snapshot file would have to hold
another planned artifact — the migrations directory named at any depth
inside the snapshot path, under any spelling of either — because a file
cannot hold a directory, and creating the directory first would leave
the snapshot's own check finding a directory `init` itself made and
reporting the snapshot as present. That refusal SHALL name both fields
and carry the same code as the one-path-for-two refusal. A snapshot file
inside the migrations directory is not this case: a directory holds a
file, and the commands that read the directory look only at migration
files. Every one of these checks SHALL be made before anything is
created, so a refused run leaves the project as it found it. A path a
configuration spells as a directory SHALL be refused the same way when
the artifact is a file: the commands that read that file resolve the
same spelling and look inside a directory that cannot hold it, so
creating anything for such a value would produce a file none of them
reads.

Whether an artifact *can* be created is one of those checks: for every
artifact the run would create, the deepest directory that already
exists on its path SHALL be checked for permission to write into before
anything is created, and a directory that refuses SHALL stop the run
with the same coded failure, naming that directory and the operating
system's own code. A creation that still fails — a permission the check
could not see, a device that filled — SHALL surface as the same coded
failure, never a raw stack, and the run SHALL remove only what this run
created, deepest first — anything it found already there stays, a
directory it reported as skipped and every file inside it included — so
that a refused run leaves the project as it found it. What to remove is
decided by this run's own record of what it created, never by which
paths the configuration names.

Where a check cannot be made at all — the operating system refuses to
say what sits at a path — the run SHALL stop with the same coded
failure, naming the operating system's own code, never a raw stack.
When the reason is a permission (`EACCES`, `EPERM`), the node the user
must act on is never the path that could not be inspected: a look-up
is refused by a directory on the way, so the refusal SHALL name the
deepest ancestor the run could still inspect, in the message and in
its `Next:` line, whether the failure surfaced at the artifact's own
path or while walking its ancestors. A failure for any other reason
SHALL name the path whose inspection failed.

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

Which configuration file that is SHALL follow `--config <path>` exactly
as it does for `generate`: an absolute path as given, a relative one
resolved from the working directory, and `./hejbro.config.ts` when the
flag is absent. The file the flag names is the one `init` reads when it
exists and the one it writes when nothing sits there — never a default
beside it — and the report SHALL name it by its path relative to the
working directory. The migrations directory and the snapshot file do not
follow the configuration file's own directory: they stay resolved from
the working directory, because that is where every command that
consumes those fields resolves them from, and `init --config X`
followed by `generate --config X` SHALL act on the same files.

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

#### Scenario: A path that cannot hold the artifact stops the run before anything is created
- **WHEN** `hejbro init` runs where a regular file sits where a
  directory holding a configured artifact would have to be, or where
  the configuration names one path for both the migrations directory
  and the snapshot
- **THEN** the run fails naming the path it cannot use, and nothing is
  created — including the artifacts whose own paths were usable

#### Scenario: A configuration that cannot be read stops the run
- **WHEN** `hejbro init` runs beside a `hejbro.config.ts` whose import
  does not resolve, or whose exported value does not match the
  configuration shape
- **THEN** the run fails with that file's own coded diagnostic and
  neither the migrations directory nor the snapshot file is created

#### Scenario: The configuration named by --config is the one read
- **WHEN** `hejbro init --config sub/hejbro.config.ts` runs in a
  directory whose only configuration sits at `sub/hejbro.config.ts`,
  whose declarations sit beside that configuration, and which names
  `db/migrations` and `db/state.json`, neither existing
- **THEN** the configuration is reported as skipped by the path
  `sub/hejbro.config.ts`, the directory and the snapshot are created at
  `db/migrations` and `db/state.json` under the working directory —
  nothing under `sub/`, nothing at the default paths — and a following
  `hejbro generate --config sub/hejbro.config.ts` reads exactly those
  artifacts

#### Scenario: The configuration named by --config is the one written
- **WHEN** `hejbro init --config sub/hejbro.config.ts` runs where
  nothing sits at `sub/hejbro.config.ts`
- **THEN** the configuration is created at that path — its parent
  directory created if absent — and reported by that path, the
  migrations directory and the snapshot are created at the defaults
  under the working directory, and no `hejbro.config.ts` is written
  beside them

#### Scenario: A snapshot path that would have to hold the migrations directory is refused
- **WHEN** `hejbro init` runs with a configuration whose
  `migrationsDir` lies inside its `snapshotPath` at any depth
  (`snapshotPath: "mig"`, `migrationsDir: "mig/sub"`), however either
  is spelled, and nothing sits at either path
- **THEN** the run fails with the same code as the one-path-for-two
  refusal, naming both fields, and nothing is created — the snapshot
  path is never reported as present

#### Scenario: A snapshot inside the migrations directory is honoured
- **WHEN** `hejbro init` runs with `migrationsDir: "mig"` and
  `snapshotPath: "mig/state.json"`, nothing existing
- **THEN** both are created and the run exits 0

#### Scenario: A permission that blocks the check is reported at the directory that blocks it
- **WHEN** `hejbro init` runs with `migrationsDir: "nx/a/mig"` and the
  directory `nx` exists with no permission to look inside it
- **THEN** the run fails with a coded refusal whose message and `Next:`
  line name `nx` — not `nx/a`, not `nx/a/mig` — and nothing is created

#### Scenario: A parent that cannot be written into stops the run before anything is created
- **WHEN** `hejbro init` runs with `migrationsDir: "mig"` and
  `snapshotPath: "ro/state.json"`, the directory `ro` exists and can be
  read but not written into, and nothing else exists
- **THEN** the run fails with a coded refusal whose message and `Next:`
  line name `ro` and the operating system's own code, no raw stack and
  no absolute path reach the output, and nothing is created — `mig`
  included

#### Scenario: A creation that fails after the checks leaves nothing behind
- **WHEN** `hejbro init` runs where every check passes and creating an
  artifact still fails part-way — a directory this run itself created
  turns out not to admit the next node
- **THEN** the run fails with the same coded refusal naming the node
  that refused, and every directory and file this run created is
  removed again, so the tree is as the run found it

#### Scenario: A dangling symbolic link at an artifact path is refused
- **WHEN** `hejbro init` runs where the configured snapshot path, the
  configured migrations directory, or a directory one of them would
  have to be created inside, is a symbolic link whose target does not
  exist
- **THEN** the run fails with the wrong-kind refusal naming that path
  and the target the link points at, nothing is created, and nothing
  is written through the link
