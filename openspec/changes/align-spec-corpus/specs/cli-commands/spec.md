# cli-commands Delta

## MODIFIED Requirements

### Requirement: A database hejbro did not create can be adopted
The CLI SHALL provide a `baseline` command that adopts an existing
database: it produces the same first migration and snapshot `generate`
would, and marks that migration in its own banner as describing objects
that already exist and must be registered as applied rather than run.

`baseline` SHALL refuse unless the project has no migrations and an empty
snapshot, naming `generate` as what to run instead — a baseline is by
definition the first migration of an adopted database. This refusal
SHALL fail with the error code `baseline-not-first` and a non-zero exit
code.

`baseline` SHALL also refuse when the run would produce no changes: the
emptiness guard above has already established that the snapshot is
empty, so nothing to adopt means the declarations loaded but exported
nothing. It SHALL fail with the error code `baseline-nothing-to-adopt`
and a non-zero exit code, naming the declaration entry points as what to
check — never the `generate` path's "no changes — snapshot already
matches your declarations" success line, which is both untrue here and
an exit 0 that hides a mistake. `generate`'s own no-change line and
exit 0 are unaffected.

`baseline` SHALL accept only the flags a first migration can use. Rename
and drop-confirmation flags are not among them — a baseline diffs against
an empty snapshot, so nothing can be renamed and nothing can be dropped.
Its `--help` SHALL NOT list them, and passing one SHALL be refused before
argument parsing with a hejbro-coded error that gives that reason and
names `generate` as the command for a change to an already-adopted
project — never a raw argument-parser message.

The emitted migration SHALL be an ordinary migration in every other
respect — same DDL, same banner hash chain — so `verify` accepts the
chain it starts and every later `generate` emits only what changed.

The command's report SHALL state the registration step explicitly, before
the user has a chance to run the file: running it against the database it
describes fails on its first statement, and "relation already exists" is
a poor way to learn that the file was never meant to be run.

Introspection — reading a live schema or a dump to write declarations —
is NOT part of this: the user writes the declarations, and confirming
they match the live schema stays a separate step.

#### Scenario: Adopting an existing database
- **WHEN** `hejbro baseline` runs on a project with declarations, no
  migrations and an empty snapshot
- **THEN** it writes one migration carrying the full DDL plus a
  `-- baseline:` banner line, writes the snapshot, and reports that the
  migration must be registered as applied without being run

#### Scenario: The chain a baseline starts is valid
- **WHEN** `hejbro verify` runs after a baseline
- **THEN** it passes — the baseline is chained and hashed exactly like
  any first migration

#### Scenario: The next change is an ordinary migration
- **WHEN** a declaration is added after a baseline and `hejbro generate`
  runs
- **THEN** the new migration contains only the added object, carries no
  baseline marker, and chains onto the baseline

#### Scenario: A baseline is refused on an existing chain
- **WHEN** `hejbro baseline` runs on a project that already has
  migrations or a non-empty snapshot
- **THEN** it fails with the error code `baseline-not-first` and a
  non-zero exit code, naming `hejbro generate` as the command for a
  change to an already-adopted project

#### Scenario: A baseline with nothing to adopt is refused
- **WHEN** `hejbro baseline` runs on a project whose declarations load
  but export nothing
- **THEN** it fails with the error code `baseline-nothing-to-adopt` and a
  non-zero exit code, writing no migration and no snapshot

#### Scenario: The baseline flag surface excludes renames and drops
- **WHEN** `hejbro baseline --help` runs
- **THEN** the flags it lists do not include the rename or
  drop-confirmation flags

#### Scenario: A rename flag passed to baseline is refused explainably
- **WHEN** `hejbro baseline --rename …` runs
- **THEN** it fails with a hejbro-coded error stating that a baseline
  diffs against an empty snapshot and naming `hejbro generate` instead,
  before any declaration is loaded or any file written

### Requirement: Declarations can be checked against a live database
The CLI SHALL provide a `check` command that compares the declared
snapshot — built in memory from the declarations, exactly as `generate`
and `verify` build it — against the catalog of a live database, and
reports where the two disagree.

`check` SHALL issue only statements that read: catalog queries and
`EXPLAIN` without `ANALYZE`, which plans a statement without running it.
It SHALL NOT write, create a database, open a transaction, change session
state, or require any privilege beyond reading the catalog and the
objects it compares. This command is not an apply path, and its
read-only-ness is a property of the statements it can issue rather than
of a transaction mode it sets.

The database SHALL be named by a `--url` flag, else by the
`DATABASE_URL` environment variable. It SHALL NOT be read from
`hejbro.config.ts`: that file is committed, and a connection string
carries a secret.

`check` is a different question from `verify` and SHALL stay a separate
command. `verify` asks whether the migration chain on disk is intact
against the snapshot; `check` asks whether the snapshot describes the
database that actually exists. Folding them together would make one
failure mean two unrelated things.

What `check` compares, per declared object, is the following — this list
is the complete comparison surface, and a comparison added later SHALL be
added to it:

- existence, by identity
- for a column: its type, its `notNull`, and its default
- for an expression-bearing object (a check constraint, an index
  predicate, a generated column): the expression, through the server's
  own rendering (its own requirement below)
- for a check constraint additionally: whether the database enforces it
  (`NOT VALID` is reported even when the expression matches)
- for a grant declared over *all tables in a schema*: the tables the
  declarations cover, not every table the schema happens to contain (a
  table hejbro does not declare is inventory, never a finding: hejbro
  cannot emit a migration for it, so reporting it as a difference would
  hand the user a failure with no fix — and the grant hejbro does emit
  is a one-shot statement that never covered that table either)

Its exit code SHALL distinguish three answers, because "the database
disagrees with you" and "I could not find out" are different facts and a
caller automating this needs to tell them apart: **zero** when everything
compared agreed, **one** when any declared object is missing or differs,
and **two** when the run could not answer — anything reported as not
compared, or a declaration set that was empty. Two is never silence: the
report still names each object it could not compare and why.

A run that could not compare something SHALL NOT exit zero. A checker
that answers "no differences" when it never looked is the failure this
command exists to end.

Where a column differs on more than one axis, `check` SHALL report all
of them from one run. Reporting only the first would make the user fix
it, run again, and meet a second difference in the same column — the
tool drip-feeding what it already knew.

`check` SHALL refuse to report a clean result for an empty declaration
set: zero declared objects means every comparison is vacuous, which is
never a real pass and is almost always the wrong path or entry point. It
SHALL fail with its own error code, distinct from an ordinary
difference's, and exit two.

#### Scenario: A column whose real type differs is reported
- **WHEN** a declaration types a column `text` and the database has it as
  `varchar(120)`, and `hejbro check` runs
- **THEN** it reports that column by its schema, table and name, states
  the declared type and the type the database has, and exits non-zero

#### Scenario: A matching database passes
- **WHEN** every declared object exists in the database with the declared
  type, nullability and default
- **THEN** `check` reports no differences and exits zero

#### Scenario: An empty declaration set is refused
- **WHEN** `hejbro check` runs against declarations that load but export
  nothing
- **THEN** it fails with its own error code and exit code two rather than
  reporting zero differences, naming the declaration entry points as what
  to check

## ADDED Requirements

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

### Requirement: The migration chain on disk is verifiable
The CLI SHALL provide a `verify` command that checks, without a
database, that the migration directory and the snapshot still agree:
every migration's banner hash chain is intact and in order, and the
snapshot's recorded hash matches the parsed-and-re-rendered snapshot —
so a hand-edited migration, a hand-edited snapshot, or a missing or
reordered file is reported as a mismatch naming the artifact, and an
untouched chain passes. `verify` SHALL accept the chain a `baseline`
starts exactly as one `generate` starts.

#### Scenario: An untouched chain passes
- **WHEN** `hejbro verify` runs over migrations and a snapshot that
  hejbro wrote and nothing edited
- **THEN** it passes with exit code zero

#### Scenario: A hand-edited artifact is reported
- **WHEN** a migration file or the snapshot is edited by hand and
  `hejbro verify` runs
- **THEN** it fails naming the artifact whose hash no longer matches,
  with a non-zero exit code
