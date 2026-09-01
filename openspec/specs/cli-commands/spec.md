# cli-commands Specification

## Purpose

The hejbro CLI's user-facing commands as contracts: what each command
does, when it refuses to run, and what its report must tell the user.
Covers `baseline` (adopting a database hejbro did not create), `check`
(comparing declarations against a live database's catalog), `generate`
(deterministic migration generation), `verify` (offline migration-chain
integrity), `migrate` (applying pending migrations to a live database),
`status` (reporting what the ledger records and what is pending),
`reset` (destroying only what the declarations manage), and `raise`
(standing an empty database up from a vendored snapshot SQL file).

## Requirements

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

### Requirement: What the catalog says does not depend on who is asking
`check` SHALL read the catalog in a way that does not depend on the
privileges of the connected role: the same database SHALL produce the
same findings whether the command connects as its owner or as a role
that may only read.

This is not automatic. `information_schema`'s grant views show only the
grants the connected role is party to, by definition, so a limited role
reading them sees fewer grants than exist and the command would report a
real grant as absent — the confident, wrong "missing" that this command
exists to prevent, produced by the command itself. Reading the
underlying catalog's own access lists instead is what makes the answer
role-independent, and those lists SHALL be read in their effective form:
an empty access list means the owner's default privileges, not the
absence of privileges.

A catalog read that fails SHALL stop the run with a coded error. It
SHALL NOT be interpreted as the absence of the objects it would have
returned.

#### Scenario: A limited role gets the same answer
- **WHEN** `check` runs against a database as a role with no privileges
  beyond reading, and again as the owner
- **THEN** both runs report the same findings

### Requirement: Differences are reported per object, never as a diff
Every difference `check` reports SHALL name the object it belongs to —
schema, table and column where they apply — and SHALL carry a hejbro
error code and a `Next:` line, like every other hejbro diagnostic.

`check` SHALL NOT report differences as diff text. A diff hunk does not
carry the identity of the object it belongs to: measured on a 32-column
table, the hunk for a wrong column type contains neither the table name
nor the schema name, so the reader cannot tell which object is wrong
without reconstructing the surrounding statement.

#### Scenario: A difference names its object
- **WHEN** `check` finds any difference
- **THEN** the report identifies the object by name and gives a coded,
  actionable line — not a fragment of SQL text whose subject must be
  inferred

### Requirement: An expression is compared through the server's own rendering
Where `check` compares an expression — a check constraint, an index
predicate, a generated column — it SHALL obtain the rendering of **both**
the declared expression and the database's own expression from **one
statement**, and compare those.

One statement, not two sent to one connection: a driver is free to pool
connections, so two statements can land on two sessions whose
`search_path` or other settings differ, and the deparse this comparison
rests on is sensitive to exactly those settings. "Same session" is
unenforceable from outside the driver — a single statement makes it true
by construction instead, and costs a round trip less. It also stays
within the no-capability rule: pinning a connection any other way means a
transaction.

Comparing hejbro's rendered text against the catalog's text directly is
not permitted. Postgres rewrites an expression when it stores it, so the
two texts differ for expressions that agree: measured against
`examples/postgres`, 8 of 8 check constraints differed textually while
being identical in meaning.

This comparison is syntactic equality of the server's own rendering. It
is not a proof of semantic equivalence, and reordered operands are
reported as a difference — hejbro's own snapshot diff treats a reordered
declaration as a change too.

The rendering SHALL be obtained in a way that does not depend on how the
database chooses to execute anything, and that row-level security cannot
suppress. An expression compared as a query *predicate* fails both:
the planner may place it differently depending on the indexes and
statistics that happen to exist, and row-security rewriting can remove it
entirely, which makes two genuinely different expressions compare equal.

Whether the database **enforces** a check constraint is compared
separately from its expression. A constraint the database is not
enforcing on existing rows states a weaker invariant than the declaration
claims, and its expression matches all the same.

#### Scenario: An expression that differs only by Postgres's rewriting passes
- **WHEN** a declared check constraint uses `in (...)` or `between`, and
  the database stores the rewritten form
- **THEN** `check` reports no difference for that constraint

#### Scenario: An expression that genuinely differs is reported
- **WHEN** a declared check constraint bounds a column at 5 and the
  database's constraint bounds it at 4
- **THEN** `check` reports that constraint as differing

#### Scenario: Row-level security does not hide a difference
- **WHEN** the connected role has no policy on the table an expression
  belongs to, and that expression genuinely differs
- **THEN** `check` still reports it as differing, rather than reporting
  agreement because the database declined to evaluate anything

#### Scenario: A constraint the database does not enforce is reported
- **WHEN** the database holds a declared check constraint as `NOT VALID`
- **THEN** `check` reports it, stating that existing rows are not
  enforced, even though its expression matches the declaration

### Requirement: The check states the boundary of its own coverage
`check` SHALL state, in its own report, what it did not compare. A
checker silent about its blind spots is read as a guarantee it never
made.

`check` SHALL NOT pass an object it could not actually compare. When a
comparison cannot be carried out — a privilege is missing, an expression
could not be rendered — that object SHALL be reported as **not compared,
with the reason**, and SHALL NOT be counted as agreeing. A false "no
differences" is worse than a false difference: it is the silent failure
this command exists to end, reintroduced by the command itself.

Two things equally leave an object out of a definite agree/differ
answer, and `check` states them differently, never as one blurred
category. A kind that states, as part of its own extension interface,
that no catalog object will ever back its declared objects is not a
comparison that failed — it is a comparison this command was never going
to attempt. `check` SHALL state that once, by the kind's own declared
reason, in its coverage-boundary section, and SHALL NOT affect the exit
code on its account: not a `Finding`, and not counted as agreeing
either. An object this command should have compared and could not — a
missing privilege, an unrenderable expression, or a declared kind this
build does not recognize — remains the other category: reported **per
object**, not compared, with the reason, and SHALL NOT let the run exit
zero.

"Not compared" SHALL NOT be used where a plainer finding is true: an
object that is genuinely absent from the database is *missing*, not
uncomparable. Missing takes precedence, so a declared table that does not
exist is reported once, as absent, rather than a second time for every
comparison its absence made impossible.

The report SHALL state that view bodies are not compared, and that a
declared object is checked for existence even where its contents are
not.

It SHALL also state that its reads are not taken as a single snapshot.
Opening no transaction is what keeps this command free of any driver
capability, and the cost of that choice is that a schema changing while
`check` runs can produce a torn report — a blind spot this command's own
rules oblige it to name rather than leave for a user to discover.

#### Scenario: The report names what was not compared
- **WHEN** `check` completes, whether or not it found differences
- **THEN** the report states the axes it does not compare, so a passing
  result is not read as a guarantee it does not make

#### Scenario: An uncomparable object is never silently passed
- **WHEN** the database elides or refuses what a comparison needed
- **THEN** that object is reported as not compared, with the reason,
  rather than counted as agreeing

#### Scenario: A kind that declares itself uncomparable states its own boundary line
- **WHEN** a declared object's kind states, in its own extension, that no
  catalog object will ever back it
- **THEN** `check` states that once in its coverage-boundary section,
  naming the kind's own declared reason, and the exit code is unaffected
  by it

#### Scenario: An unregistered kind is reported as not compared, never as differing
- **WHEN** a declared object's kind is not one this build recognizes
- **THEN** `check` reports it as not compared, with the reason, and the
  run cannot exit zero on the strength of a comparison that never ran

#### Scenario: A catalog read that fails stops the run
- **WHEN** a catalog read fails outright
- **THEN** `check` stops with a coded error naming that failure, and no
  object is reported as absent on the strength of a read that never
  succeeded

#### Scenario: An absent object is reported once
- **WHEN** a declared table does not exist, so every comparison that
  depended on it could not be carried out either
- **THEN** `check` reports the table as missing and does not additionally
  report each dependent comparison as not compared

#### Scenario: The report does not claim a consistent snapshot
- **WHEN** `check` completes
- **THEN** the report states that its reads were not taken as a single
  snapshot, so a schema changed mid-run can produce a torn result

### Requirement: Objects the declarations do not manage are reported, not failed on
`check` compares in one direction: from the declarations to the database.
An object that exists in the database and in no declaration is therefore
invisible to every comparison above, and a user who reads a passing
`check` as "my declarations cover this database" would be wrong.

`check` SHALL report, as information and not as a difference, the tables
inside the declared schemas that no declaration covers, and the
extensions the database has. This SHALL NOT affect the exit code: these
objects are not errors, and a project may legitimately leave objects
unmanaged.

Extensions are reported because their absence is silent and expensive: a
declaration whose default calls `gen_random_uuid()` needs `pgcrypto`, and
nothing in the declared set records that.

#### Scenario: An unmanaged table is reported without failing
- **WHEN** the database has a table in a declared schema that no
  declaration covers, and everything declared agrees
- **THEN** `check` lists that table as unmanaged and exits zero

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
