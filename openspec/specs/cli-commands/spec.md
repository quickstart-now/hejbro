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
- for a column: its type and its `notNull`; then, for a column that is
  not generated, its default; for a generated column, whether the
  database's column is generated too, and its expression (through the
  server's own rendering, its own requirement below). A default is never
  compared for a column generated on either side: a generated column
  cannot carry one, so a difference reported on that axis would be a
  difference the user cannot act on
- for an expression-bearing object (a check constraint, an index
  predicate, an index's expression columns, a generated column): the
  expression, through the server's own rendering (its own requirement
  below)
- for a check constraint additionally: whether the database enforces it
  (`NOT VALID` is reported even when the expression matches)
- for an index additionally: the number of keys in its ordered key list,
  and every key position at which either side is an expression, through
  the server's own rendering (its own requirement below). A position at
  which both sides are plain columns, an index's uniqueness and its
  access method are not compared beyond the index's existence
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

#### Scenario: A matching generated column is not reported
- **WHEN** a declaration holds a column `generated always as (price * qty)
  stored`, the database holds that column generated with the same
  expression, and `hejbro check` runs
- **THEN** no finding names that column — in particular none about a
  default — and, every other object agreeing, the run exits zero

#### Scenario: A column generated on one side only is reported on that axis
- **WHEN** a declaration holds a generated column and the database holds
  a plain column of that name, or the declaration holds a plain column
  and the database holds it generated
- **THEN** `check` reports that column as differing, stating which side
  is generated, and reports no finding on its default axis

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
Where `check` compares an expression through the server's rendering — a
check constraint's expression, an index's predicate, an index's
keys, a generated column's expression — it SHALL obtain
the rendering of **both** the declared expression and the database's own
expression from **one statement**, and compare those. The four surfaces
SHALL be compared by one rule: the same statement form, the same fallback
where no rendering can be obtained, the same reporting of what could not
be compared. An expression `check` knows how to compare on one surface
and leaves uncompared on another would report as present what it never
looked at.

An index is compared as an ordered key list. A database index's
`INCLUDE` columns are not keys — they carry no ordering and cannot be
declared — so they are neither counted nor compared. The declared keys
and the database's keys are paired by position, and every position at which
either side is an expression is compared through the rendering — a plain
column renders as itself, so a declared expression the server stores as a
plain key (a bare column reference, a parenthesized column, a column with
a collation) agrees with the database that hejbro's own migration
produced, and a declared plain column against a database expression
differs. The database's key text carries its collation where that
collation is not the column's default, so a declared `col collate "C"` is
paired with what the database actually holds; the server's rendering
drops a collation from both sides alike, so a difference in collation
alone is not visible through the rendering and is not reported — the
same limit that leaves a key's sort direction and operator class
uncompared. A key list whose length
differs is reported as differing on the count, in either direction, and
no rendering is probed for it; a predicate present on one side only is
reported as differing the same way, in either direction. Every declared
index reaches this comparison, whether or not the declaration itself
carries a predicate or an expression: a filter on the declared side alone
would pass a database index that grew a predicate or an expression the
declaration never had. A position at which both sides are plain columns
is not compared by this requirement or any other beyond the index's
existence, nor are an index's uniqueness and access method.

One statement, not two sent to one connection: a driver is free to pool
connections, so two statements can land on two sessions whose
`search_path` or other settings differ, and the deparse this comparison
rests on is sensitive to exactly those settings. "Same session" is
unenforceable from outside the driver — a single statement makes it true
by construction instead, and costs a round trip less. It also stays
within the no-capability rule: pinning a connection any other way means a
transaction. One object's expressions — an index's predicate and its
keys — MAY share one statement; two objects' never need to.

Comparing hejbro's rendered text against the catalog's text directly is
not permitted where a rendering can be obtained. Postgres rewrites an
expression when it stores it, so the two texts differ for expressions
that agree: measured against `examples/postgres`, 8 of 8 check
constraints differed textually while being identical in meaning.

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

Existence takes precedence over this comparison, as it does everywhere in
`check`: an index or a column that is absent from the database is
reported once, as missing, and its expression is not additionally
reported as uncomparable.

On a platform whose registered preset declares that the server cannot
plan a statement, no rendering can be obtained. There, and only there,
`check` SHALL compare the declared expression's text with the catalog's
own text after a fixed normalization — whitespace outside string
literals, one parenthesis pair enclosing the whole text, the enclosing
table's qualifier on a column reference, identifier quoting where the
identifier would render unquoted anyway, a type cast the server appended
to a string literal, and letter case outside quoted identifiers and
string literals — and nothing else, on every one of the four surfaces, each compared key
position of an index normalized on its own. Texts equal after that normalization SHALL count as
agreeing. Texts that still differ SHALL be reported as **not compared**,
carrying both texts and a `Next:` that names restating the declaration in
the catalog's own spelling; they SHALL NOT be reported as differing,
because a textual difference is not evidence of a different meaning. The
`Next:` line SHALL NOT ask the user to run or be granted `EXPLAIN` on such
a platform. The report's coverage boundary SHALL state that the run
compared expressions by normalized text. On a platform whose presets make
no such declaration, a failure to obtain the rendering remains reported
exactly as before.

Wherever a diagnostic carries an expression text — a declared or a catalog
expression in a not-compared finding, both renderings in a differing
finding — the text SHALL be delimited by a character that is not one of
SQL's own quote characters (`"`, `'`): a table-bound expression begins
with a double-quoted identifier, so a double quote as the delimiter is
indistinguishable from the text it delimits. Error codes and `Next:`
lines are unaffected by the delimiter.

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

#### Scenario: A partial index's predicate that differs only by rewriting passes
- **WHEN** a declared partial index's predicate renders
  `"tasks"."status" <> 'done'` and the database holds the index with
  `WHERE (status <> 'done'::text)`
- **THEN** `check` reports no difference for that index

#### Scenario: A partial index whose predicate genuinely differs is reported
- **WHEN** a declared partial index's predicate is `archived_at is null`
  and the database's index of that name carries `archived_at is not null`
- **THEN** `check` reports that index as differing, naming it by schema,
  table and name

#### Scenario: An expression index whose expression matches passes
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on `lower(email)`
- **THEN** `check` reports no difference for that index

#### Scenario: An expression index whose expression differs is reported
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on `upper(email)`
- **THEN** `check` reports that index as differing

#### Scenario: A key that is an expression on one side only is reported in either direction
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on the plain column `email` — or the declared index is
  on the plain column `email` and the database's index of that name is on
  `lower(email)`
- **THEN** `check` reports that index as differing at that key position,
  in either direction

#### Scenario: An index whose key count differs is reported on the count
- **WHEN** a declared index has two keys and the database's index of that
  name has three, or the reverse
- **THEN** `check` reports that index as differing, stating both key
  counts, and no rendering is probed for it

#### Scenario: A database index's INCLUDE columns are not keys
- **WHEN** a declared index is on `a` and the database's index of that
  name is on `a` with `include (b)` — or the declared index is on `a, b`
  and the database's index of that name is on `a` with `include (b)`
- **THEN** the first reports no difference, and the second reports the
  index as differing on its key count, one against two

#### Scenario: A declared expression the server stores as a plain key is not a difference
- **WHEN** a declaration's index key is a bare column reference, a
  parenthesized column, or `col collate "C"` written as an expression, the
  migration hejbro generated for it is applied, and `hejbro check` runs
- **THEN** it reports no difference for that index, because the
  database's key renders as the same thing the declaration renders as

#### Scenario: An index partial on one side only is reported in either direction
- **WHEN** a declared index carries a predicate and the database's index
  of that name carries none, or the declared index carries none and the
  database's index of that name carries `where archived_at is null`
- **THEN** `check` reports that index as differing, stating which side is
  partial, and no rendering is probed for it

#### Scenario: A generated column whose expression matches passes
- **WHEN** a declared column is `generated always as (price * qty) stored`
  and the database holds it generated with an expression the server
  renders identically
- **THEN** `check` reports no difference for that column

#### Scenario: A generated column whose expression differs is reported
- **WHEN** a declared column is generated as `price * qty` and the
  database's column of that name is generated as `price + qty`
- **THEN** `check` reports that column as differing on its expression

#### Scenario: A missing index is reported once, never as uncomparable
- **WHEN** a declared partial index does not exist in the database
- **THEN** `check` reports it as missing and does not additionally report
  its predicate as not compared

#### Scenario: Under a preset that declares no planning, equal normalized texts agree
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders
  `length(btrim("projects"."name")) > 0`, and the catalog holds
  `(length(btrim(name)) > 0)`
- **THEN** `check` reports no difference for that constraint, and its
  coverage boundary states that expressions were compared by normalized
  text on this run

#### Scenario: Under a preset that declares no planning, a rewritten expression is not compared
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"role" in ('owner', 'admin')`, and
  the catalog holds `(role = ANY (ARRAY['owner'::text, 'admin'::text]))`
- **THEN** `check` reports that constraint as not compared, carrying
  both texts, with a `Next:` that names restating the declaration in the
  catalog's spelling and never mentions `EXPLAIN`, and the run does not
  exit zero

#### Scenario: Under a preset that declares no planning, a string literal's content is never normalized
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"projects"."format" <> '"json"'`,
  and the catalog holds `(format <> 'json'::text)`
- **THEN** `check` reports that constraint as not compared: no
  normalization step rewrites the inside of a string literal, so the
  quoted word in the literal and the qualifier-like text a literal may
  carry stay exactly as written on both sides

#### Scenario: Under a preset that declares no planning, a failed catalog read is not compared without asking for EXPLAIN
- **WHEN** a registered preset declares the platform cannot plan a
  statement, and reading the constraint's own expression from
  `pg_constraint` fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, and its `Next:` names the catalog read to confirm
  and never asks the user to run or be granted `EXPLAIN`

#### Scenario: Under a preset that declares no planning, an index predicate and a generated column follow the same text rule
- **WHEN** a registered preset declares the platform cannot plan a
  statement, a declared partial index's predicate renders
  `"tasks"."archived_at" is null` while the catalog holds
  `(archived_at IS NULL)`, and a declared generated column renders
  `"widgets"."price" * "widgets"."qty"` while the catalog holds
  `(price * (qty)::numeric)`
- **THEN** `check` reports no difference for the index, reports the
  generated column as not compared carrying both texts with a `Next:`
  that never mentions `EXPLAIN`, and no `explain` statement reaches the
  server for either

#### Scenario: Without such a declaration, a failed rendering is reported as before
- **WHEN** no registered preset declares the platform cannot plan a
  statement, and the rendering statement fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, exactly as it does today, and never compares by
  text

#### Scenario: A reported expression text is delimited apart from SQL's quotes
- **WHEN** a declared expression renders `"posts"."role" = 'owner'` and
  `check` reports it as not compared, or reports both renderings of a
  differing expression
- **THEN** each expression text in the diagnostic is enclosed by a
  delimiter that is neither `"` nor `'`, so the text's own leading quoted
  identifier is not mistaken for the end of the delimited text, and the
  finding's code and `Next:` line are the same as before

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

`check` SHALL report, as information and not as a difference, the
extensions the database has and every object the database holds inside
the declared schemas that no declaration covers: a table, and — on a
table the declarations manage — a column, an index and a check
constraint. This SHALL NOT affect the exit code: these objects are not
errors, and a project may legitimately leave objects unmanaged.

The table alone is not enough, and stopping there was the blind spot this
requirement exists to close. A column, an index or a check constraint the
database holds on a table hejbro manages is exactly the object a reader
of a passing `check` believes is covered, and `import` tells the user in
its own loss report that `check` keeps naming what a declaration could
not carry. All three kinds are reported by one rule: a kind reported on
one axis and silently dropped on another would state a coverage the
command does not have.

This inventory is existence only, by identity. Nothing in it reads a
type, a default or an expression, so nothing in it can report a
difference that is not one, and nothing in it is a `Finding`.

Its boundaries are what keep it from naming an object twice, or naming
one where nothing true can be said:

- an object is inventoried only when the table holding it is one the
  declarations manage. A table no declaration covers is itself reported,
  once, and the objects it holds SHALL NOT be listed under it — the table
  line already says everything true about them.
- a table declared with `existingTable()` is outside this inventory
  entirely, its columns, indexes and check constraints included, exactly
  as the table itself already is: such a declaration claims a shape
  hejbro does not own, so nothing on it is hejbro's to call unmanaged.
- a schema no declaration touches stays out of scope, for objects exactly
  as for tables: hejbro has nothing to say about a schema this project
  never mentions.
- an index that backs a constraint the declarations name — a declared
  primary key, a declared unique column — SHALL NOT be reported as an
  unmanaged index. The declaration accounts for it, under that
  constraint's own name, and Postgres creates it with that name; a
  database hejbro's own migration produced would otherwise report an
  unmanaged index for every key it declared. Which constraint an index
  backs SHALL be read from the catalog's own record of it, never
  inferred from the two names matching — and the record to read is the
  constraint the index *implements*. A foreign key's own catalog record
  names the index it points at on the referenced table; read without
  that distinction, a key another table references is reported as
  unmanaged once for every foreign key pointing at it, each time under
  that foreign key's name. Any other index the catalog
  holds on a managed table is inventoried — and where such an index
  backs a constraint, its line SHALL name that constraint, so that a
  reader is not sent looking for an index nobody wrote.

The inventory SHALL be ordered by the identity each line names, and
ordered by that identity's UTF-16 code units — not by a collation,
whether the database's or the machine's. What the rule needs is a total
order that no locale can vary and in which no two distinct names ever
compare equal; code-unit order is exactly that, and it coincides with
code-point order for every identity outside the astral planes. A report
ordered by a collation is
ordered differently on two machines that disagree about locale, and two
identities a collation treats as equal have no order at all between
them, which is the same defect one step further in. Every axis of the
inventory follows this one rule, so that two runs against the same
database print the same report, and two databases holding the same
objects print them in the same order whatever order the catalog
returned them in.

Extensions are reported because their absence is silent and expensive: a
declaration whose default calls `gen_random_uuid()` needs `pgcrypto`, and
nothing in the declared set records that.

#### Scenario: An unmanaged table is reported without failing
- **WHEN** the database has a table in a declared schema that no
  declaration covers, and everything declared agrees
- **THEN** `check` lists that table as unmanaged and exits zero

#### Scenario: A column the database holds and no declaration covers is reported without failing
- **WHEN** a table the declarations manage holds a column no declaration
  covers — including one `import` omitted because no declaration could
  carry its name — and everything declared agrees
- **THEN** `check` names that column by its schema, table and name as
  unmanaged, reports no difference for it, and exits zero

#### Scenario: An index and a check constraint the database holds on a managed table are reported without failing
- **WHEN** a table the declarations manage holds an index and a check
  constraint no declaration covers, and everything declared agrees
- **THEN** `check` names each of them by its schema, table and name as
  unmanaged, reports no difference for either, and exits zero

#### Scenario: An index backing a declared key is not called unmanaged
- **WHEN** the declarations declare a primary key and a unique column,
  hejbro's own migration for them is applied, and `hejbro check` runs
- **THEN** no inventory line names the indexes Postgres created for those
  two constraints, and the run exits zero

#### Scenario: An unmanaged index that backs a constraint names that constraint
- **WHEN** a table the declarations manage carries a primary key or a
  unique constraint no declaration names, and `hejbro check` runs
- **THEN** `check` reports that constraint's own index as unmanaged,
  naming the constraint it backs beside the index's identity, and exits
  zero

#### Scenario: An unmanaged table's own objects are not listed under it
- **WHEN** the database has a table in a declared schema that no
  declaration covers, holding columns, indexes and check constraints
- **THEN** `check` reports that table once, as unmanaged, and reports no
  inventory line for any object it holds

#### Scenario: An existing declaration's own objects are never inventoried
- **WHEN** a schema declares a table with `existingTable()` and the
  database's table of that name holds columns, indexes and check
  constraints beyond what the declaration names
- **THEN** no inventory line names the table or any object on it, and the
  exit code is unaffected

#### Scenario: The inventory is ordered the same way on every run
- **WHEN** `hejbro check` runs twice against a database holding several
  unmanaged columns, indexes and check constraints
- **THEN** both runs print the same inventory lines in the same order

#### Scenario: The order does not depend on a collation
- **WHEN** two databases hold the same unmanaged objects, created in
  different orders — including two whose names a collation treats as
  equal without being the same name — and `hejbro check` runs against
  each, under two different locales
- **THEN** all four runs print the inventory lines in the same order

### Requirement: Migrations are generated deterministically from declarations
The CLI SHALL provide a `generate` command that diffs the declarations
against the last snapshot and writes the updated snapshot together with
the migration carrying what changed — one migration, and more than one
only where Postgres's own transaction semantics require a boundary
between statements the run produced. Generation SHALL be deterministic:
the same declarations against the same snapshot SHALL produce
byte-identical migration SQL, byte-identical snapshot bytes, and the same
number of migration files, run anywhere, with no database connection.

Within a kind, the statements a run emits SHALL follow the declarations'
own dependency order: a declared object is created — or altered — after
the declared objects it references, so a table carrying a foreign key to
another declared table comes after that table, whichever order their
identities sort in, and a mutually referencing pair — which no order
satisfies — keeps its existing identity order. A reset's drops run in
reverse *dependency* order — a dependent before what it depends on,
computed from the same references (migration-apply) — never the literal
reverse of the statement sequence this run emits. The migration's own name SHALL
NOT follow it: the name is derived from the change list as it stands
before this dependency refinement — kind order, then identity — so that
refining the order a run emits never renames the file a run writes.

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

#### Scenario: A referencing table is created after the table it references
- **WHEN** two declared tables in one schema are generated from an empty
  snapshot, one carrying a foreign key to the other, and the referencing
  table's identity sorts first
- **THEN** the migration creates the referenced table before the
  referencing one

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

`verify` SHALL also run every validator a registered preset provides —
the same check `generate` runs before writing anything — over the
declarations against the snapshot its own snapshot-parity check already
builds, and SHALL refuse with the identical coded error `generate` would
raise for the same declaration, so a declaration `generate` refuses
never passes `verify` silently. Where the active configuration registers
no preset validator — including a configuration with no preset at all —
this check does not run at all, and `verify`'s report is unaffected by
its existence.

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

#### Scenario: A preset-refused declaration is refused by verify too
- **WHEN** a registered preset's validator would refuse a declaration at
  `hejbro generate` time, and `hejbro verify` runs against the same
  declarations and its checked-in snapshot
- **THEN** `verify` fails with the identical coded error `generate`
  would raise for that declaration

#### Scenario: A configuration with no preset runs unaffected
- **WHEN** the active configuration registers no preset validator — no
  preset at all, or a preset that provides kinds but no validator — and
  `hejbro verify` runs on declarations that pass every other check
- **THEN** it passes exactly as it would without this capability
  existing, and its report never mentions a preset-validator check

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
database **and declared**. Renaming is what makes the name one a
declaration can carry, and the report SHALL offer no other way to get
there — the DSL derives every column's SQL name from its
TypeScript key and accepts no explicit name beside it, so no
hand-written declaration can carry either kind of name, in this
repository or in a linked one. Renaming alone SHALL NOT be stated as
the end of the reporting: a renamed column is a column the declarations
still do not carry, and `check` goes on naming it as unmanaged until
they do. A foreign key's own catalog name SHALL survive into the starter
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
  that column until it is renamed in the database and declared

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
  where that configuration file already exists and names `snapshotPath:
  "state.json"`, nothing else existing
- **THEN** the run fails with the one-path-for-two code, its message
  says a file cannot hold a file in the first case and a directory in
  the second, its `Next:` names the configured field to move — and
  `--config` where the configuration file is the held artifact — and
  nothing is created

### Requirement: A preset declares whether its platform can plan a statement
A provider preset SHALL be able to declare that its platform cannot plan
a statement — that `EXPLAIN` is not available — as data on the preset
value (`explainUnavailable: true`), fixed before any connection exists
and never discovered by probing the server. Its absence SHALL mean the
platform can plan, so no existing preset changes meaning by staying
silent. `check` SHALL read the declaration from the presets the
configuration registers, and from nowhere else: the connection `check`
opens is the vanilla driver's, so a declaration on a preset's driver
would never reach it.

The Nile preset SHALL carry the declaration.

#### Scenario: The declaration is readable as data
- **WHEN** a preset value declaring `explainUnavailable` is examined
  before any connection is made
- **THEN** the declaration is present as data, and nothing was sent to a
  server to establish it

#### Scenario: Silence means the platform can plan
- **WHEN** `check` runs with presets that make no such declaration
- **THEN** it compares expressions through the server's own rendering,
  exactly as before

#### Scenario: The Nile preset declares it
- **WHEN** the Nile preset value is examined
- **THEN** it declares `explainUnavailable`

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

### Requirement: A set's order is never a snapshot movement
Where `generate` decides whether the snapshot moved, and where `verify`
decides whether the checked-in snapshot matches the declarations, two
snapshots that differ only in the order of a set-shaped array — a
policy's roles, a trigger's events and an update event's columns, a
table's indexes and checks — SHALL count as identical. A run whose
declarations differ from the checked-in snapshot only by such an order
SHALL write neither a migration nor a snapshot and report the no-change
line, and `hejbro verify` SHALL pass over that pair; the canonical order
reaches the file with the next run that has something to record. This
qualifies "identical" in the generation rule and "matches your
declarations" in the verification rule, and nothing else in either.

The hash chain is untouched by this: the tip migration's recorded hash
is still compared against the snapshot file's canonical serialization —
every value and every order, though not its formatting — so a hand edit
of the snapshot that changes a value or reorders a set is still reported
as a tip mismatch. What changes is only the comparison of the file against the
declarations, which reads both through the canonical form.

#### Scenario: A reorder-only difference writes nothing and verifies
- **WHEN** the checked-in snapshot lists a policy's roles, a trigger's
  events, or a table's indexes or checks in one order, the declarations
  list the same members in another, and `hejbro generate` then `hejbro
  verify` run
- **THEN** `generate` writes nothing and reports the no-change line, and
  `verify` passes with exit code zero

#### Scenario: A hand-reordered snapshot is still a tip mismatch
- **WHEN** the snapshot file's own roles array is reordered by hand, so
  its canonical serialization no longer hashes to the tip migration's
  `snapshot:` line, and `hejbro verify` runs
- **THEN** it fails naming the tip migration and the snapshot path, as
  it does for any hand edit

#### Scenario: The next real change writes the canonical order
- **WHEN** the checked-in snapshot carries a set-shaped array in a
  non-canonical order and a run adds a column to any table
- **THEN** the migration carries that column's statement and nothing
  else, and the written snapshot lists every set-shaped array in
  canonical order

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
