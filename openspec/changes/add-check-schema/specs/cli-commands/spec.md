# cli-commands (delta)

## ADDED Requirements

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

`check` SHALL compare, per declared object: existence by identity, and
for a column its type, its `notNull`, and its default. It SHALL exit
non-zero when any declared object is missing or differs, and zero when
none do.

`check` SHALL refuse to report a clean result for an empty declaration
set: zero declared objects means every comparison is vacuous, which is
never a real pass and is almost always the wrong path or entry point. It
SHALL fail with a distinct code from an ordinary difference.

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
- **THEN** it fails with its own code rather than reporting zero
  differences, naming the declaration entry points as what to check

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
the declared expression and the database's own expression from the same
database in the same session, and compare those.

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

### Requirement: The database driver is an optional dependency
`check` SHALL acquire its driver dynamically and SHALL NOT make any
database driver a hard runtime dependency of the CLI: every other command
works without one, and installing hejbro must not pull in a driver for
commands that never connect.

When the driver is absent, `check` SHALL fail with a hejbro-coded
diagnostic naming the package to install — never a raw module-resolution
error.

`check` SHALL NOT require any driver capability. Every statement it
issues is a plain read that a driver must already support to be a driver
at all, so no capability negotiation stands between this command and a
database. This is a constraint on the design, not an observation about
today's drivers: a future comparison that needs session state or a
transaction would be trading this property away, and that trade is the
decision to surface.

#### Scenario: A missing driver is explained
- **WHEN** `hejbro check` runs in a project without the driver package
- **THEN** it fails with a hejbro-coded error naming the package to
  install, not a module-resolution stack trace
