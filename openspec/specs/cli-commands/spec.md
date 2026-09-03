# cli-commands Specification

## Purpose

The hejbro CLI's user-facing commands as contracts: what each command
does, when it refuses to run, and what its report must tell the user.
Covers `baseline` (adopting a database hejbro did not create), `check`
(comparing declarations against a live database's catalog), `generate`
(deterministic migration generation), and `verify` (offline
migration-chain integrity). `migrate` (applying pending migrations to a
live database), `status` (reporting what the ledger records and what is
pending), `reset` (destroying only what the declarations manage), and
`raise` (standing an empty database up from a vendored snapshot SQL
file) are also part of the CLI's user-facing surface, but their
contracts are requirements of the `migration-apply` capability, not this
one — this Purpose names all eight commands so a reader who lands here
first knows where each one's contract actually lives.

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
against the last snapshot and writes the updated snapshot together with
the migration carrying what changed — one migration, and more than one
only where Postgres's own transaction semantics require a boundary
between statements the run produced. Generation SHALL be deterministic:
the same declarations against the same snapshot SHALL produce
byte-identical migration SQL, byte-identical snapshot bytes, and the same
number of migration files, run anywhere, with no database connection.

A run whose declarations produce a snapshot identical to the previous
one SHALL write neither a migration nor a snapshot, report "no changes
— snapshot already matches your declarations", and exit zero. A run
that produces a **different** snapshot but no statement to write SHALL
write the snapshot together with a migration carrying no statements,
whose banner records the state before and after exactly as any other
migration's does — so the chain stays anchored and a repository nobody
edited still passes `hejbro verify` — and SHALL report the migration it
wrote and that it carries no statements, and exit zero. That migration's
name SHALL be derived from the difference between the two snapshots, by
the same naming rules every other migration follows and as
deterministically: the same pair of snapshots SHALL always produce the
same name, never a generic fallback. A snapshot can move without any
table changing hands — a declaration restating a table hejbro already
records the same way — and such a run SHALL be named from the table
whose record changed, exactly as deterministically. Only a run whose
snapshot moved with no table's record changing at all is a fault in
hejbro, and it SHALL be reported as a coded diagnostic naming itself as
one, never as a crash.

Whether a run has something to write is decided by comparing the
snapshot it arrived at against the previous one, never by whether the
migration SQL came out empty. An empty statement list decides what a
migration *contains*, not whether one exists: a state hejbro recorded is
a state the chain has to carry, or `verify` is left calling an untouched
repository edited. Whether a run has something to write and whether it
emitted any statement are two facts, not one: a run can have a snapshot
to write and no statement to emit. Generation SHALL state each of them
on its own, so that no caller has to infer one from the other or
reconcile a result that reports no change while carrying a migration.

`generate`'s flag surface carries the rename flags
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
enabled SHALL still write it (or refresh it, if one already exists). An
export SHALL describe the snapshot its own run arrived at, never the
previous one.

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

The decision is made over the run's own **encoded expression nodes** —
an encoded string-literal node, a `sql` template's own text chunks, and
a `sql.raw` node's text — never over the statements as rendered for the
database, so this SHALL is a claim about what the surface reads, not
about text the database would see. Within that surface, the test is by
the value's spelling: the value as written, and its spelling with every
`'` doubled (the form a string literal carries it in when the value
itself holds a quote), matched wherever the characters immediately
before and after are not a letter, digit or underscore — an identifier
boundary, not a bare substring search. It over-approximates in the
direction that boundary licenses: the same word inside a comment or an
unrelated string SHALL still cause a split, and that is deliberate. A
literal carries no type of its own, so distinguishing "this enum's
value" from "a string that looks like it" would mean inferring the type
of every expression — and the two failures are not symmetric: an
unnecessary split costs one extra migration that applies cleanly, while
a missed one costs a migration that passes every check hejbro has and
fails against the database. A value assembled by concatenation or
produced by a function call is not a spelling and is not seen. A `sql`
template's text chunks are each tested on their own: a value split
across a chunk boundary by an interpolated parameter is not that value.

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

#### Scenario: A recorded declaration that emits nothing still anchors the chain
- **WHEN** an `existingTable()` declaration is added to a repository
  whose snapshot already matches its declarations, and `hejbro generate`
  runs
- **THEN** the snapshot is written with the table recorded as existing,
  a migration carrying no statements is written alongside it, the report
  names both, the exit code is zero — and `hejbro verify` run afterwards
  passes, as does a later run that does emit statements

#### Scenario: A changed existing declaration is named and anchored like any other
- **WHEN** an `existingTable()` declaration's own columns change — a
  column added, renamed or retyped — and `hejbro generate` runs
- **THEN** the run does not fail, a migration carrying no statements is
  written whose name says what changed about the declaration, the
  snapshot records the new columns, and `hejbro verify` passes
  afterwards

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

### Requirement: The migration chain on disk is verifiable
The CLI SHALL provide a `verify` command that checks, without a
database, that the migration directory and the snapshot still agree:
every migration's banner hash chain is intact and in order, and the
snapshot's recorded hash matches the parsed-and-re-rendered snapshot —
so a hand-edited snapshot, an edited `parent-snapshot:` or `snapshot:`
hash line (other than the first migration's own `parent-snapshot:`,
which is the chain root and is taken as given), a migration missing
from anywhere but the start of the chain, or a migration whose order
changed is reported as a mismatch, and an untouched chain passes.
`verify` SHALL accept the chain a `baseline` starts exactly as one
`generate` starts.

The two hash lines are hashes of the normalized declaration snapshot
before and after the migration, never of the file's own SQL text
(migration-format), and the chain is checked link by link from its
first hashed file onward. `verify` therefore vouches for the recorded
sequence of declared states, and not for the files around it. Mutations
outside its reach include — this list names the measured ones, not
every possible one — an edit to a migration's SQL body that leaves its
hash lines intact, an edit to any other banner line (the summary lines,
the `hejbro:` version line), a rename that keeps a file's sort position
(no hash covers the filename), the removal of the first migration or of
any leading run of migrations up to and including all of them (whatever
file is first is the root, and its `parent-snapshot:` is taken as given;
an empty directory has no tip to compare), and a file added with no
hash lines at all (the walk skips it,
though `verify`'s summary line still counts it among the migrations).
Each of these SHALL pass `verify` unreported. The limit is stated so
that nobody reads a passing `verify` as proof that applied SQL matches
generated SQL. The
one body edit hejbro does catch — a transaction-control statement — is
refused at apply time (migration-apply); detecting other body edits
needs a record of what was applied, which is a separate capability.

#### Scenario: An untouched chain passes
- **WHEN** `hejbro verify` runs over migrations and a snapshot that
  hejbro wrote and nothing edited
- **THEN** it passes with exit code zero

#### Scenario: A hand-edited artifact is reported
- **WHEN** a migration's `parent-snapshot:` or `snapshot:` hash line —
  other than the first migration's `parent-snapshot:` — or the snapshot
  file is edited by hand, and `hejbro verify` runs
- **THEN** it fails with a non-zero exit code, naming the artifact when
  the failing check knows one

#### Scenario: A body edit that keeps the hash lines passes
- **WHEN** a migration's SQL body is edited by hand, its hash lines left
  intact, and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: Removing a leading run of migrations passes
- **WHEN** the first migration of a chain, or every migration, is deleted
  and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: A rename that keeps a file's position passes
- **WHEN** a migration file is renamed without changing its sort position
  and `hejbro verify` runs
- **THEN** it passes with exit code zero

#### Scenario: A file with no hash lines is skipped but counted
- **WHEN** a file with no banner hash lines is added to the migrations
  directory and `hejbro verify` runs
- **THEN** it passes with exit code zero, and the summary line counts the
  added file among the migrations

#### Scenario: A tip mismatch names the artifacts that disagree
- **WHEN** the last migration's `snapshot:` hash and the on-disk
  snapshot's own hash differ
- **THEN** the report names that migration file and the snapshot path,
  and states the observation only — never a cause

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

### Requirement: The apply commands leave existing declarations alone
`hejbro check` SHALL compare nothing about an existing table — one the
schema declares with `existingTable()` — and SHALL NOT list it in the
unmanaged inventory. That inventory's sense of *unmanaged* is a table no
declaration covers, and an existing declaration covers one: it claims a
shape hejbro does not own. Its presence or absence in the database SHALL
NOT affect the exit code.

Not comparing it is a choice, not a failure, so it belongs in neither
category the coverage-boundary rules already name: nothing about it
could not be carried out, and its kind is comparable for every other
table. `check` SHALL therefore name it in the report's
coverage-boundary section as declared existing and not compared —
"what it did not compare" covers a table it declined to compare as much
as one it was unable to. That line SHALL NOT be a finding and SHALL NOT
affect the exit code. Naming it is what keeps a passing report from
being read as a guarantee about a shape `check` never looked at — so
wherever the report summarises the objects that agreed, an existing
declaration SHALL NOT be among them.

`hejbro reset` SHALL drop nothing of an existing table, `hejbro
baseline` SHALL write no statement for one, and `hejbro raise` SHALL be
unaffected by such a declaration — it reads migration text and the
ledger, never a declaration.

#### Scenario: An existing declaration is neither compared nor inventoried
- **WHEN** a schema declares a table with `existingTable()` and `hejbro
  check` runs against a database where that table exists with a
  different shape
- **THEN** no difference is reported for it, it is absent from the
  inventory section, and the exit code is unaffected

#### Scenario: An existing declaration is named in the coverage boundary, never as a finding
- **WHEN** a schema declares a table with `existingTable()` and `hejbro
  check` runs
- **THEN** the report's coverage-boundary section names that table as
  declared existing and not compared, it is not a finding, it is absent
  from the unmanaged inventory, and the exit code is unaffected

#### Scenario: baseline and reset pass an existing declaration by
- **WHEN** a schema declaring a table with `existingTable()` is
  baselined, and a later `hejbro reset` runs against it
- **THEN** the baseline migration carries no statement for that table,
  and the reset drops nothing of it

### Requirement: import writes starter declarations from a database
The CLI SHALL provide an `import` command that reads a database through
the catalog (connection from `--url`, else `DATABASE_URL`, never from
`hejbro.config.ts` — the rule `check` follows) and writes one starter
declaration file per schema into a directory the command names,
refusing to overwrite any existing file. The schemas to read SHALL be
named explicitly — `--schema`, repeatable, with no default — and a run
that names none SHALL refuse with a coded diagnostic that shows the
common answer; a database's schemas include its platform's own
(`auth`, `storage` and their neighbours on a hosted Postgres), and
adopting those as declarations is not a default anyone can want. The
destination SHALL be named explicitly too (`--out`, no default), and a
run whose named schemas hold nothing to infer — or nothing it can
declare, every one of them omitted for its own name — SHALL say so with
its own code, a different code for each of those two reasons, rather
than writing empty files, and SHALL leave the destination untouched,
creating not even the directory. Where the reason is omission, the
report's `Omitted:` lines SHALL be printed with the refusal: that a
schema was found and could not be carried is the one useful thing such
a run has to say, and it is not the same statement as "nothing is
there". The files SHALL declare what
the reading inferred with the DSL's own builders, and the command SHALL
print the loss report. A column the DSL cannot name SHALL be omitted
from the starter files and named in the loss report with the reason it
could not be carried — and the two reasons are different and SHALL be
told apart: either no declaration key produces that SQL name back (the
DSL derives a column's SQL name from its key by snake_case, so a quoted
`"createdAt"` has no key that yields it), or a key does produce it back
and the DSL's own identifier rule rejects the name itself, as it
rejects the leading-underscore `_id`. The consequence is the same for
both and SHALL be stated with the line: the table is only partly
declared, and `check` reports that column until it is renamed in the
database. Renaming is the only way out there is, and the report SHALL
offer no other — the DSL derives every column's SQL name from its
TypeScript key and accepts no explicit name beside it, so no
hand-written declaration can carry either kind of name, in this
repository or in a linked one. A foreign key's own catalog name SHALL survive into the starter
declaration — written out where it differs from the name the DSL would
derive, left implicit where it does not — because `check` compares
foreign keys by name, and a database hejbro did not create names them
its own way. A catalog name D36 cannot carry at all is the one
exception: that key is declared under the derived name and the report
announces the approximation, since a foreign key's name is a label on a
constraint the declaration still expresses, not the constraint's own
identity. The starter files' imports SHALL never form
a cycle — and a reference to another file's enum counts as an import,
exactly as a foreign key to another file's table does: where a cycle
would form, the crossings in one direction are declared against
unexported reference-only declarations, a handle for a table and a
local copy of the enum for an enum. A foreign key into a table no
starter file declares — one whose schema this run never named — SHALL
be declared against such a handle too, for a different reason: there is
no file to import its target from. A starter file therefore never names
a table this run did not read except through a handle of its own, and it
SHALL carry one handle per target rather than one per foreign key,
however many of its keys point there: a handle names a table, not a
relation, and the reading that produces them counts them the same way —
two artifacts of one reading that count the same thing differently
disagree about which of them is right. No
identifier a starter file declares or imports SHALL collide with a name
the file's own emitted text already binds, the extras callback's own
parameter included: a table whose identifier would collide with it is
declared under another identifier instead, because a shadowed reference
inside a callback resolves to that callback's column proxy rather than
to the table, and the file then loads as nothing at all — a failure that
reaches the reader as a load error naming the file, never as a report
line about the table. Each
file SHALL
open with a header carrying
the loss report in full and the statement that the file is the
repository's own from now on, and SHALL carry no clock- or
machine-derived value, so importing the same database twice writes
byte-identical files. After an `import`, `baseline` SHALL emit the DDL that creates what the
database already has, marked in its own banner as describing objects
that already exist, so that `migrate` registers that migration rather
than runs it; `baseline` refuses once a project has any migration, so
it is not something `generate` prepares work for. A `generate` against
the same empty snapshot would emit the same statements, as a migration
meant to run.

#### Scenario: Declaration files never import each other in a cycle
- **WHEN** two schemas' files would reference each other — by foreign
  key, by a column typed with the other file's enum, or one of each —
  so their imports would form a cycle
- **THEN** the crossings in one of the two directions are declared
  against reference-only declarations that are not exported, whatever
  their columns and actions: a handle for a table, a local copy for an
  enum, so the files' imports form no cycle, nothing is declared twice,
  and loading does not depend on which file the loader reaches first

#### Scenario: A table named like the emitted callback's parameter still loads
- **WHEN** a reading covers a table whose identifier would collide with
  the parameter the emitted extras callback binds — the table declared in
  the file that references it, the table imported from another file, or
  the table on the declared side of a cut cycle
- **THEN** each of the three files is written with that table under an
  identifier that does not collide, and each loads through the loader
  `generate` itself uses and type-checks, in every entry order

#### Scenario: A second import writes the same bytes
- **WHEN** the same database is imported twice, into two empty
  directories
- **THEN** the two sets of files are identical byte for byte, and each
  file's header carries the loss report and says the file is the
  repository's own from now on

#### Scenario: A database is imported into starter files
- **WHEN** `hejbro import --url <db> --out src/schema --schema app
  --schema billing` runs against a database holding both
- **THEN** two declaration files are written, the loss report is
  printed, and a following `baseline` emits a first migration whose
  objects match the database's, marked in its banner so that `migrate`
  registers it rather than runs it

#### Scenario: a column the DSL cannot name is left out and said so
- **WHEN** a table holds a column whose SQL name no declaration key can
  produce, such as a quoted `"createdAt"` (the DSL derives a column's
  SQL name from its key by snake_case)
- **THEN** the starter file leaves that column out, the loss report
  names it and its table, gives that column's own reason — no
  declaration key produces that SQL name back — and states the
  consequence: the table is only partly declared, and `check` reports
  that column until it is renamed in the database

#### Scenario: a column the DSL rejects by name is left out the same way
- **WHEN** a table holds a column named `_id`, whose inferred key
  produces that same SQL name back but whose name the DSL's own
  identifier rule rejects
- **THEN** the run completes exactly as it does for a name no key can
  produce — the starter file leaves that column out, the loss report
  names it with its table and consequence, and every other column of
  that table is declared — but the report gives this column's own
  reason, that the identifier rule rejects a name a key does produce
  back, rather than saying no key produces it

#### Scenario: import refuses to guess which schemas to read
- **WHEN** `hejbro import --url <db> --out src/schema` runs with no
  `--schema`
- **THEN** it fails with a coded diagnostic that names `--schema` and
  shows the common answer, and writes nothing

#### Scenario: The named schemas hold nothing to infer
- **WHEN** every schema named by `--schema` holds no table, enum or
  sequence the reading can infer
- **THEN** it fails with its own coded diagnostic naming those schemas,
  and writes no files at all

#### Scenario: Every named schema was omitted for its name
- **WHEN** every schema named by `--schema` holds objects, but each
  schema's own catalog name is one no declaration can carry
- **THEN** it fails with a code of its own — not the one for schemas
  that are empty, since the two say different things — its output
  carries the `Omitted: schema …` line for each of them with what to do
  about it, and the destination directory is not created

#### Scenario: import never overwrites
- **WHEN** the output directory already holds a file `import` would
  write
- **THEN** it fails with a coded diagnostic naming the file and writes
  nothing

### Requirement: pull reads a database as the marked fallback
The CLI SHALL provide `pull --db-url <url>` that feeds a catalog reading
to the same contract emitter `vendor` uses, writes the contract with an
origin naming the database rather than a commit, and prints the loss
report naming `link` as the way out. It SHALL use no other source of
schema than the catalog, and SHALL name the schemas to read the way
`import` does — `--schema`, repeatable, with no default, for the same
reason: a hosted database's own platform schemas are never what a
consumer meant to contract against. Its destination is not named on the
command line at all: the contract goes where `vendor` puts it.

#### Scenario: A contract is pulled from a database
- **WHEN** `hejbro pull --db-url <db> --schema public` runs
- **THEN** a contract is written whose header says it was inferred from
  a database, whose `Tables` are the inferred tables with guessed keys,
  and the loss report is printed

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
overwrite this command never does. The same refusal SHALL cover a path
an artifact would have to be created inside, and a configuration that
names one path for two artifacts: neither can be satisfied, and one of
them would otherwise be reported as already present. Every one of these
checks SHALL be made before anything is created, so a refused run leaves
the project as it found it. A path a configuration spells as a
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
