## ADDED Requirements

### Requirement: A migrations directory that cannot be listed is refused before it is read
Every command that lists the migrations directory — `generate`,
`baseline`, `verify`, `history`, `migrate`, `status`, `restore` — SHALL
judge what sits at the configured `migrationsDir` before listing it,
by the same judgement `init` applies to the same path. A regular file
there, or a symbolic link whose target does not exist, SHALL stop the
run with the error code `migrations-dir-not-a-directory`, naming the
configured path and — for a link — the target it points at, with a
`Next:` naming the way back to a directory. A path that cannot be
inspected or listed — a directory on the way that refuses the look-up,
a file on the way, a link on the way whose target does not exist, a
directory the process may not read — SHALL stop the run with the error
code `migrations-dir-unreadable`, naming the configured path, and its
`Next:` SHALL name the node that blocks: the deepest ancestor the run
could still inspect for a permission, the file or link itself
otherwise. The operating system's own code is named where the operating
system refused — a permission, a loop, a listing that failed; a file or
a dangling link on the way is a judgement of kind, named by the node
and what it is, with no code to report. A symbolic link to a
directory is that directory. Nothing at the configured path is not a
fault: the directory is read as holding no migrations, exactly as
before, and the commands that write into it create it. Neither refusal
SHALL surface as a raw listing failure, and neither message SHALL carry
an absolute path.

#### Scenario: A file at the migrations directory is refused with its own code
- **WHEN** a regular file sits at the configured `migrationsDir` and
  `hejbro generate`, `hejbro verify`, `hejbro baseline` or `hejbro
  history` runs
- **THEN** it fails with the error code `migrations-dir-not-a-directory`
  naming that path and a `Next:` line, before any migration or snapshot
  is written, and no raw filesystem error and no absolute path reaches
  the output

#### Scenario: A dangling link at the migrations directory is refused, never read as empty
- **WHEN** a symbolic link whose target does not exist sits at the
  configured `migrationsDir` and `hejbro generate` runs
- **THEN** it fails with the error code `migrations-dir-not-a-directory`
  naming that path and the target the link points at, and writes
  nothing through the link

#### Scenario: A migrations directory that cannot be inspected names the node that blocks it
- **WHEN** the configured `migrationsDir` is `nx/mig` and the directory
  `nx` exists with no permission to look inside it, or `nx` is a regular
  file, and `hejbro generate` runs
- **THEN** it fails with the error code `migrations-dir-unreadable`
  naming the configured path — with the operating system's own code
  where `nx` refused the look-up, and as the file it is where `nx` is a
  file — and its `Next:` line names `nx` — the same node `hejbro init`
  names for the same tree

#### Scenario: An absent migrations directory is still no migrations
- **WHEN** nothing sits at the configured `migrationsDir` and `hejbro
  generate` runs against an existing empty snapshot
- **THEN** the run proceeds as before, creating the directory when it
  has a migration to write

### Requirement: The `--config` flag names a file
Every command that accepts `--config <path>` — `init`, `generate`,
`baseline`, `history` — SHALL resolve the value the same way: an
absolute path as given, a relative path from the working directory. A
value that is empty or only whitespace — `--config=`, `--config ""` —
SHALL be refused before any path is resolved, with the error code
`invalid-config-flag` and a `Next:` naming the flag's form and that
dropping the flag means `./hejbro.config.ts`; it SHALL never be
resolved to the working directory, since the refusal that would follow
tells the user to remove the directory they are standing in.

The commands that read the configuration SHALL judge what sits at the
resolved path before loading it, by the same judgement `init` applies
to the same path. Nothing there SHALL fail with the error code
`config-not-found`, naming the path that was looked up and, in its
`Next:`, `hejbro init` with the same `--config` value when the flag was
given — never a default the user did not ask for. The value that
`Next:` echoes is the one the user typed, as typed: a path the user
supplied is never re-spelled, whether it was absolute or relative and
wherever the command was run from. That echo is the user's own input
reflected back, not a path hejbro discovered — the one place an
absolute path may appear in a report — and it appears in the `Next:`
command only; the header and every label still name the path relative
to the working directory. A directory there, or
a symbolic link whose target does not exist, SHALL fail with the error
code `config-not-a-file`, naming the path — and the link's target —
once, and a `Next:` naming the node to move and that `--config` can
name another file. A path that cannot be inspected — a permission on the
way, a file on the way, a link on the way whose target does not exist —
SHALL fail with the error code `config-unreadable`, naming the path —
and the operating system's own code where the operating system refused
the look-up; a file or a dangling link on the way is named by the node
and what it is — and its `Next:` SHALL name the node that blocks,
decided as `init` decides it. `init` SHALL refuse the same
trees with the same sentences under its own code, and SHALL create the
configuration only where the judgement found nothing at all.

#### Scenario: An empty --config value is refused by every command that takes the flag
- **WHEN** `hejbro init --config=`, `hejbro generate --config=` or
  `hejbro history --config ""` runs
- **THEN** it fails with the error code `invalid-config-flag`, its
  `Next:` shows the flag's form, nothing is created, and no message
  tells the user to remove the working directory

#### Scenario: A missing configuration is named by the path that was looked up
- **WHEN** `hejbro generate --config sub/hejbro.config.ts` runs and
  nothing sits at `sub/hejbro.config.ts`
- **THEN** it fails with the error code `config-not-found` naming
  `sub/hejbro.config.ts`, and its `Next:` names `hejbro init --config
  sub/hejbro.config.ts` — and without the flag the message names
  `hejbro.config.ts` and `hejbro init`, exactly as before

#### Scenario: A directory or a dangling link at the configuration path is refused as not a file
- **WHEN** a directory, or a symbolic link whose target does not exist,
  sits at the path `--config` names (or at `hejbro.config.ts` with no
  flag), and `hejbro generate` runs
- **THEN** it fails with the error code `config-not-a-file`, naming the
  path once — and the link's target — never an import-resolution
  diagnostic, and `hejbro init` on the same tree refuses naming the same
  node with the same `Next:`

#### Scenario: A file on the way to the configuration path is named as the file
- **WHEN** `hejbro generate --config f/hejbro.config.ts` runs and `f` is
  a regular file
- **THEN** it fails with the error code `config-unreadable` whose
  message and `Next:` name `f` as the file in the way — never
  `f/hejbro.config.ts` as a path to check — and `hejbro init --config
  f/hejbro.config.ts` names `f` too

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
path and the target the link points at, spelled relative to the working
directory like every other path in a report — writing through it would
create the artifact somewhere the report never named, and reporting it
as absent would be the same lie one step later. A link that sits where
an artifact would have to be created inside SHALL be judged the same
way. The same refusal SHALL cover a path
an artifact would have to be created inside, and a configuration that
names one path for two artifacts: neither can be satisfied, and one of
them would otherwise be reported as already present. Every artifact's
path — the configuration file's included — is judged by its ancestors
before its own node, so a file, a dangling link or a closed directory
on the way is named as the node that blocks, never as the artifact's
own path with a bare operating-system code. It SHALL equally
cover a configuration whose planned file — the snapshot, or the
configuration file itself — would have to hold another planned
artifact, named at any depth inside its path, under any spelling of
either: a file holds nothing, and creating the held artifact first
would leave the file's own check finding a node `init` itself made and
reporting the file as present. That refusal SHALL name both artifacts,
SHALL say which kind the held artifact is — a directory or a file —
and carry the same code as the one-path-for-two refusal; its `Next:`
SHALL name the thing the user can actually change: the configured
field, or, where the configuration file is one of the two, the field
that points inside it and `--config`. A snapshot file
inside the migrations directory is not this case: a directory holds a
file, and the commands that read the directory look only at migration
files. Every one of these checks SHALL be made before anything is
created, so a refused run leaves the project as it found it. A snapshot
path a configuration spells as a directory is refused when the
configuration is read, by every command, so `init` never meets one.

A refusal about the configuration file's own path SHALL describe that
path as the configuration path, never as a field named after the file,
so the file's name appears once — the reader is told what the path is
for, not the same name twice.

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
flag is absent; an empty value is refused as every other command
refuses it. The file the flag names is the one `init` reads when it
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
- **THEN** the run fails with a coded refusal whose reason and `Next:`
  line name `nx` as the directory that blocks — the artifact label
  still reads `nx/a/mig` — and nothing is created

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

#### Scenario: A file on the way to the configuration path is named as the file
- **WHEN** `hejbro init --config f/hejbro.config.ts` runs and `f` is a
  regular file
- **THEN** the run fails with a coded refusal whose message and `Next:`
  name `f` as the file that would have to be a directory — never
  `f/hejbro.config.ts` with a bare operating-system code — and nothing
  is created, exactly as the same tree under `migrationsDir: "f/mig"`
  is refused

#### Scenario: A directory at the configuration path is refused naming it once
- **WHEN** `hejbro init` runs where a directory sits at
  `hejbro.config.ts`
- **THEN** the run fails with a coded refusal whose message names
  `hejbro.config.ts` as the configuration path and the directory found
  there, without repeating the file's name as a field, and whose
  `Next:` names moving that directory or naming another file with
  `--config`

#### Scenario: A planned file that would have to hold another artifact is refused by the held artifact's kind
- **WHEN** `hejbro init` runs with `snapshotPath:
  "hejbro.config.ts/state.json"`, or with `migrationsDir:
  "hejbro.config.ts/mig"`, or with `--config state.json/hejbro.config.ts`
  and `snapshotPath: "state.json"`, nothing existing
- **THEN** the run fails with the one-path-for-two code, its message
  says a file cannot hold a file in the first case and a directory in
  the second, its `Next:` names the configured field to move — and
  `--config` where the configuration file is the held artifact — and
  nothing is created

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
spelled, including a leading `./`, a trailing separator on a directory
path, and a `..` that leaves the working directory.

A `snapshotPath` whose spelling names a directory — a trailing
separator, an empty value, or a last segment that is `.` or `..` —
SHALL be refused the same way: when the configuration is read, by every
command that reads it, with the error code `invalid-config` naming the
field and a `Next:` naming the spelling to drop. It names a directory
where a file belongs, and no command could ever read or write a file
under that spelling; refusing it once, before any command looks at the
disk, is what keeps `init` and the commands that read the snapshot from
answering the same value two ways — one refusing the spelling, the
other finding the file under the stripped spelling and then failing to
open it under the spelled one, as a permission problem that did not
exist. `migrationsDir` is a directory and keeps every one of those
spellings.

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

#### Scenario: A snapshot path spelled as a directory is refused by every command
- **WHEN** a configuration sets `snapshotPath` to `"state.json/"`,
  `""`, `"."` or `"db/.."`, and `hejbro init`, `hejbro generate` or any
  other command that reads the configuration runs
- **THEN** it fails with the error code `invalid-config` naming
  `snapshotPath`, before any artifact is read or written, and the same
  configuration with `migrationsDir: "mig/"` is not refused for that
  field

### Requirement: A snapshot that cannot be read as a file is refused before it is read
Every command that reads the snapshot file — `generate`, `baseline`,
`verify`, `check` — SHALL check what sits at the configured snapshot
path before reading it, by the same judgement `init` applies to the
same path: a symbolic link is judged by what it points at, and the
path's ancestors are judged before the path itself. A directory there,
or a link to one, SHALL stop the run with the error code
`snapshot-not-a-file`, naming the configured path and the kind expected
there, with a `Next:` that names the way back to a snapshot file. A
link whose target does not exist SHALL stop the run with the same code,
naming the configured path and the target the link points at, spelled
relative to the working directory — never read as an absent snapshot,
whose `Next:` would send the user to a command that refuses the same
tree. A file there that the process cannot read SHALL stop the
run with the error code `snapshot-unreadable`, naming the configured
path and the operating system's own code, with a `Next:` naming the
permissions to check. The kind is decided first: a directory is refused
as a directory even when it could not have been read, and only a
regular file whose read fails is refused as unreadable. A snapshot
whose path cannot even be inspected SHALL be refused as unreadable
too, and its `Next:` SHALL name the node that blocks the look-up,
decided exactly as `init` decides it: for a permission, the deepest
ancestor the run could still inspect, with the operating system's own
code; for a file or a dangling link on the way, that file or link by
its own path and what it is, with no code — never the configured path
as a thing to check permissions on. Neither SHALL surface as a raw read
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

#### Scenario: A dangling link at the snapshot path is refused, never read as absent
- **WHEN** a symbolic link whose target does not exist sits at the
  configured `snapshotPath` and `hejbro generate`, `hejbro baseline`,
  `hejbro verify` or `hejbro check` runs
- **THEN** it fails with the error code `snapshot-not-a-file` naming
  that path and the target the link points at, never with the
  not-found code, and `hejbro init` on the same tree names the same
  path and target

#### Scenario: A file on the way to the snapshot path is named as the file
- **WHEN** the configured `snapshotPath` is `f/state.json`, `f` is a
  regular file, and `hejbro generate` runs
- **THEN** it fails with the error code `snapshot-unreadable` whose
  message and `Next:` name `f` as the file in the way — never
  `f/state.json` as a path to check permissions on — and `hejbro init`
  on the same tree names `f` too
