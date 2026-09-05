## MODIFIED Requirements

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
carries a secret. The driver SHALL be the configuration's own factory
when one is set, called with that resolved string; otherwise the
vanilla driver, imported on demand, with a coded diagnostic naming the
package to install when it is absent.

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

## ADDED Requirements

### Requirement: A configured driver factory serves every command that connects
`hejbro.config.ts` MAY name a `driver`: a function from a connection
string to a contract driver, returned directly or as a promise. Every
command that connects — `check`, `status`, `migrate`, `raise`, `reset`,
`import` and `pull` — SHALL use the configured factory when one is set:
it resolves the connection string from its own connection flag
(`--db-url` for `pull`, `--url` for the other six), else
`DATABASE_URL`, exactly as before, calls the factory once with that
string, probes the
returned driver with one trivial read, runs its work, and closes the
driver afterwards. `@hejbro/pg` is neither imported nor required on
that path. A factory that throws SHALL surface as the command's own
connection-failed diagnostic, describing the thrown error. A driver the
factory returns that offers no way to close SHALL be refused before any
statement is sent, with a coded error naming the `driver` field and the
missing member. Every driver hejbro itself ships SHALL expose that
member, so a factory built from a shipped driver is never the one
refused: the vanilla driver, both Neon drivers, and every decorator
that spreads its base. Closing a driver that holds nothing open does
nothing, and SHALL be documented as doing nothing rather than left
absent — Neon's HTTP driver opens no connection to close, and a missing
member would refuse it for a fault it does not have. The factory SHALL receive the resolved connection
string only — never the configuration and never the environment — and
the configuration file SHALL still never carry a connection string.
Capability requirements are unchanged: an apply command refuses a
driver without interactive transactions whichever way it was built.
Without a configured factory every command SHALL behave exactly as it
did before the field existed. The configuration loader SHALL accept a
function and nothing else for the field and SHALL name it in its shape
hint.

Three of these commands — `import`, `pull` and `raise` — did not read
the configuration at all before this field existed. They SHALL read it
now, and a missing configuration file SHALL mean "no factory" rather
than a refusal: these are the commands a project runs before it has a
`hejbro.config.ts`, so refusing them for its absence would take away
the bootstrap they exist for. A configuration file that exists but
fails to load SHALL refuse the command with that load error, exactly as
it already does for the other four — a misspelled `driver` is not
silently ignored anywhere.

#### Scenario: Each connecting command uses the configured factory
- **WHEN** the configuration names a factory that records what it is
  called with and returns a recording driver, and each of `check`,
  `status`, `migrate`, `raise`, `reset`, `import` and `pull` runs with
  its own connection flag (`--db-url` for `pull`, `--url` for the other
  six)
- **THEN** each command calls the factory exactly once with the string
  that flag carried, every statement it sends reaches the recording
  driver, the driver is closed when the command ends, and `@hejbro/pg`
  is never imported

#### Scenario: A command that never read the configuration still runs without one
- **WHEN** `import`, `pull` or `raise` runs in a project that has no
  `hejbro.config.ts`
- **THEN** it connects through the vanilla driver exactly as it did
  before the field existed; and when a configuration file is present but
  fails to load, that command refuses with the load error and the
  factory is never consulted

#### Scenario: The environment names the database for the factory too
- **WHEN** a factory is configured and a command runs with its own
  connection flag absent (`--db-url` for `pull`, `--url` for the other
  six) but `DATABASE_URL` set
- **THEN** the factory receives the environment's string; with neither
  set the command fails naming both ways, and the factory is never
  called

#### Scenario: A throwing factory is a failed connection
- **WHEN** the configured factory throws
- **THEN** the command fails with its own connection-failed code, the
  message describes the thrown error and ends with a `Next:` line, and
  nothing was sent

#### Scenario: A driver that cannot be closed is refused
- **WHEN** the configured factory returns a contract driver with no
  closing member
- **THEN** the command fails with a coded error naming the `driver`
  field and the missing member, before any statement is sent

#### Scenario: No factory, no change
- **WHEN** the configuration names no factory
- **THEN** every connecting command imports the vanilla driver on
  demand and behaves byte-for-byte as before, except that `pull`'s two
  connection diagnostics (`pull-connection-missing`,
  `pull-connection-failed`) now name its own `--db-url` flag where they
  used to say `--url` -- the correction the "fails naming both ways"
  requirement above demands, and the only byte that moves

#### Scenario: A decorated driver reaches the commands
- **WHEN** a Supabase project configures `driver: (url) =>
  supabaseDriver(pgDriver(url), { endpoint: "transaction-pooler" })`
  and `hejbro check` runs
- **THEN** the statements `check` sends go through the decorated
  driver, and an apply command on the same configuration is refused
  or admitted by the decorated driver's own capability declaration

#### Scenario: The field is validated
- **WHEN** the configuration sets `driver` to a string
- **THEN** loading fails naming the field and the expected shape,
  before any command work
