# Delta: cli-commands

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
anything has a chance to run the file: running it against the database it
describes fails on its first statement, and "relation already exists" is
a poor way to learn that the file was never meant to be run. The report
SHALL name the hejbro command that registers it, rather than describing a
step the reader has to arrange in a pipeline of their own, and SHALL name
the hejbro command that compares declarations against a live database
rather than a comparison the reader is to perform by hand.

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

#### Scenario: The report names the commands that carry out its next steps
- **WHEN** `hejbro baseline` completes
- **THEN** its report names the hejbro command that registers the
  migration as applied and the hejbro command that compares the
  declarations against the live database, rather than a step to arrange
  or a comparison to run by hand

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
the decision to surface. Commands that apply migrations make that trade
openly and state the capability they require; the property being
protected here is `check`'s, not the CLI's as a whole.

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

### Requirement: Migrations are generated deterministically from declarations
The CLI SHALL provide a `generate` command that diffs the declarations
against the last snapshot and writes the updated snapshot together with
the migration carrying what changed — one migration, and more than one
only where Postgres's own transaction semantics require a boundary
between statements the run produced. Generation SHALL be deterministic:
the same declarations against the same snapshot SHALL produce
byte-identical migration SQL, byte-identical snapshot bytes, and the same
number of migration files, run anywhere, with no database connection. A
run that finds no difference SHALL write no migration and no snapshot,
report "no changes — snapshot already matches your declarations", and
exit zero. `generate`'s flag surface carries the rename flags
(identifying a rename that would otherwise diff as drop-plus-add) and
the drop-confirmation flags (confirming a destructive change by the
dropped object's name); those flags are `generate`'s own, which is why
a baseline refuses them.

Where the export is enabled, generation SHALL also write the export
described by `schema-export`, from the same pass over the declarations,
so that a repository cannot hold a migration and an export that
disagree about what was declared. **This SHALL hold even when there is
no difference to write a migration for**: a repository whose snapshot
already matches its declarations has no other run that could ever
produce its first export, so a no-difference run with the export
enabled SHALL still write it (or refresh it, if one already exists).

A run SHALL be split where it adds a value to an existing enum type and
also emits that value into an expression the database resolves while
executing the statement that carries it. That condition is the rule, and
it SHALL be decided from the statements the run is about to emit rather
than from a list of the places such an expression can appear: a list
covers the kinds someone thought of when it was written, and the cost of
a kind it misses is a migration that fails against a database after
passing every check hejbro has. Column defaults, generated columns,
check constraints, index expressions and predicates, a policy's `using`
and `with check`, and view bodies all satisfy the condition today.

A value appearing only inside a function body does not satisfy it: a
`plpgsql` body's SQL is not resolved when the function is created, and
hejbro emits no other kind of function body. Creating an enum type and
using its values in the same run does not satisfy it either — the
restriction applies to values added to a type that already existed.

The test is by the value's spelling, and it over-approximates: a string
literal elsewhere in the same run that happens to read the same as the
added value causes a split it did not need. That is deliberate. A
literal carries no type of its own, so distinguishing "this enum's
value" from "a string that looks like it" would mean inferring the type
of every expression — and the two failures are not symmetric: an
unnecessary split costs one extra migration that applies cleanly, while
a missed one costs a migration that passes every check hejbro has and
fails against the database.

Where a run is split, the migrations it writes SHALL carry distinct
versions under every prefix strategy, and SHALL each carry their own
banner so the chain they form verifies. A name supplied on the command
line SHALL NOT collapse them into one file.

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

#### Scenario: A run that crosses a transaction boundary writes two migrations
- **WHEN** a run adds a value to an existing enum type and adds a column
  defaulting to that value
- **THEN** two migrations are written — the enum change first, the column
  second — with distinct versions, banners that chain, and a final
  snapshot identical to what an unsplit run would have produced

#### Scenario: A value used only inside a function body does not split a run
- **WHEN** a run adds a value to an existing enum type and references
  that value only inside a `plpgsql` function body
- **THEN** one migration is written
