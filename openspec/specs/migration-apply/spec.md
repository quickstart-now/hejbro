# migration-apply Specification

## Purpose
How a migration hejbro wrote reaches a database, and what is true after
it does: the order migrations are applied in, the ledger of hejbro's own
writes that records them, the transaction each one runs in, the lock
that keeps two runners apart, and what a failure leaves behind. Sibling
to `migration-format`, which says what a migration file carries; this
says what happens when one is run.

## Requirements

### Requirement: Migrations are applied in chain order, and what was applied is recorded
The CLI SHALL apply the migrations on disk that the database's ledger
does not record, in the order the chain gives them — never the order a
directory listing gives them.

A **ledger** is a table hejbro creates in the database it applies to,
qualified `"hejbro"."migration_ledger"`, holding one row per applied
migration. The ledger is the record of hejbro's own writes: it says what
this tool applied, and it never claims anything about the shape of the
schema. Reading the catalog to judge the declarations is a different
question and is not part of this capability. A row's columns are a
database-assigned identity, the migration's full filename, the origin
recorded below, and the timestamp the database assigned it.

Each row's **origin** column SHALL record how it entered the ledger, as
`origin text not null check (origin in ('applied', 'registered',
'raised'))`, with no default — every writer states its own origin,
because there is no value that would be correct to assume: `applied`
for a chain migration this tool ran, `registered` for a baseline
migration recorded without being run, or `raised` for a snapshot SQL
file `raise` applied outside the chain entirely. Registering happens on
exactly one path, so `origin = 'registered'` already *is* "this was a
baseline file" — no information is lost by naming the value after how
the row entered rather than after the kind of file it came from. A row
whose origin is `raised` SHALL NOT be judged by the "A ledger row with
no file is reported" disagreement further below: a raised database
begins outside the chain by design (the raise requirement near the end
of this capability states this), so `migrate` and `status` treat that
origin as a known starting point rather than a disagreement.

The ledger's bootstrap SHALL be idempotent and SHALL run once per apply
run, not once per migration. A row's ordering SHALL come from a value
the database assigns, never from a value the engine supplies. A row
SHALL identify its migration by the migration's full filename, because
tools that key on the version prefix alone cannot tell two migrations
of the same version apart.

A ledger table that does not exist and a ledger table that holds no rows
are different facts and SHALL be reported differently: the first is a
database hejbro has never applied to, the second is one where hejbro has
applied nothing yet — which is the state a registered baseline leaves
behind.

`migrate`'s exit code SHALL distinguish three answers: zero when there
was nothing pending or every pending migration applied, one when the
database refused a migration, and two when the run could not act at all
— an unverifiable chain, a ledger disagreement, or a missing connection,
driver or capability. Its report SHALL name, in their own buckets, the
migrations this run applied, the baseline migrations this run
registered without running, the migrations another concurrent run
already applied while this one waited, and the baseline migrations
another run already registered while this one waited — a baseline is
never reported as applied, because no statement of its own ever reached
the database.

Every command in this capability that connects to a database —
`migrate`, `status`, `reset`, and `raise` — SHALL be given the database
by a `--url` flag, else the `DATABASE_URL` environment variable, and
SHALL NOT read it from `hejbro.config.ts`: that file is committed, and a
connection string carries a secret.

#### Scenario: Pending migrations are applied in chain order
- **WHEN** a database's ledger records the first two migrations of a
  chain of four and `migrate` runs
- **THEN** the third and fourth are applied in that order and the ledger
  holds four rows

#### Scenario: The bootstrap is idempotent
- **WHEN** `migrate` runs twice against the same database
- **THEN** the ledger table is created once, the second run adds no row
  for a migration already recorded, and neither run fails

#### Scenario: An absent ledger and an empty ledger are told apart
- **WHEN** the ledger table does not exist, and separately when it
  exists with no rows
- **THEN** the two are reported as different states, and neither is
  reported as the other

### Requirement: A migration is applied atomically with its own ledger row
Each migration SHALL be applied inside one transaction that also writes
its ledger row, so that a database never holds a migration the ledger
does not record, nor a row for a migration that did not fully apply.

The migration's statements SHALL be sent as a single statement text
carrying no parameters. A parameter turns the same text into a prepared
statement, which refuses to carry more than one command; the ledger row
is written by its own statement inside the same transaction, where
parameters are available because it is one command.

A run that fails SHALL stop at the failing migration and leave the
migrations before it applied and recorded. Partial application *within*
a migration does not occur and SHALL NOT be modelled: there is no state
in which some of a migration's statements are applied.

#### Scenario: A failed migration leaves nothing behind
- **WHEN** a migration whose second statement fails is applied
- **THEN** the object its first statement created does not exist
  afterwards, and the ledger holds no row for that migration

#### Scenario: A run stops at the first failing migration
- **WHEN** the second of three pending migrations fails
- **THEN** the first is applied and recorded, the third is not applied,
  and the report names the second

#### Scenario: The statements carry no parameters
- **WHEN** a migration is applied
- **THEN** its text goes to the database as one parameterless statement,
  and the ledger row is written by a separate statement in the same
  transaction

### Requirement: An applied file carries no transaction control of its own
A migration hejbro applies SHALL NOT contain `begin`, `commit` or
`rollback`. hejbro's generator emits no such statement; a hand-edited
file can, and the consequences are invisible rather than loud. A
`commit` inside the file ends the transaction early, so the statements
before it survive a later failure with no error raised, and a failure
after a file's own `begin` leaves the connection in a state that fails
every statement sent after it.

A migration containing transaction control SHALL be refused before it is
applied, with a hejbro error naming the statement and the file.

#### Scenario: A file that manages its own transaction is refused
- **WHEN** a migration containing `commit;` is about to be applied
- **THEN** it is refused with a coded error naming the statement, and
  nothing is applied

### Requirement: Concurrent runs are serialized, and the lock is transaction-scoped
Two runners applying at once is the ordinary case in a deployment
pipeline. The apply path SHALL take a lock scoped to the applying
transaction, so it is released when that transaction ends — including
when it ends by failing.

A session-scoped lock SHALL NOT be used. Statements issued outside a
transaction are not guaranteed to reach the same connection, so such a
lock can be held by a connection the next statement never gets; the
appearance of correctness under sequential use is a property of an idle
connection pool and not of the contract.

#### Scenario: A second runner waits
- **WHEN** two `migrate` runs start against the same database at once
- **THEN** one applies while the other waits; the one that waited then
  applies only what the ledger does not record at the moment it holds
  the lock, and neither run fails

#### Scenario: A failed run releases its lock
- **WHEN** an apply run fails inside its transaction
- **THEN** the lock is released and a following run proceeds

### Requirement: The apply path requires a driver that can hold a transaction
Applying SHALL require a driver declaring the interactive-transaction
capability, and SHALL refuse, with a hejbro-coded diagnostic naming the
capability, a driver that does not. This is a requirement stated in the
contract rather than an assumption about which drivers exist: a driver
whose endpoint takes one statement per request and cannot open a
transaction can carry neither half of this design, and the refusal has
to name why rather than fail somewhere inside a half-applied run.

#### Scenario: A driver without interactive transactions is refused
- **WHEN** `migrate` runs with a driver that declares no
  interactive-transaction capability
- **THEN** it fails with a coded error naming the capability, before any
  *migration* statement is sent

### Requirement: A baseline is registered rather than run
A migration carrying the baseline marker describes objects that already
exist. The apply path SHALL record it in the ledger with the
`registered` origin, without executing its statements — never the
`applied` origin, which is reserved for a migration whose statements
were actually sent — and SHALL read the marker through the exported
parser rather than by matching the banner's text.

#### Scenario: A baseline migration is recorded without being executed
- **WHEN** a chain whose first migration carries the baseline marker is
  applied to the database it describes
- **THEN** no statement from that migration is sent, the ledger records
  it with the `registered` origin, and the migrations after it apply
  normally

### Requirement: Applying refuses a chain that does not verify, and reports what disagrees
The apply path SHALL verify the migration chain on disk before opening a
database connection at all: each hash names the normalized declaration
snapshot before and after that migration — never a file's own SQL bytes,
the same fact `migration-format`'s own requirement states about these
lines — so applying a chain whose hashes do not agree is applying
migrations no snapshot vouches for, and the check needs no database to
make. This is why the chain catches a hash-chain line edited, a file
removed, or the order rearranged — between the ends of the chain, as
the next paragraph bounds it — but not a hand-edit to a migration's own
SQL body: the chain was never a witness to that body, so a body edit is
instead what the transaction-control refusal above exists to bound.
The pre-flight is the chain walk alone — each file's `parent-snapshot:`
against the previous file's `snapshot:` — and nothing else: the apply
path reads no snapshot file, so `verify`'s tip check (the last
migration's `snapshot:` against the on-disk snapshot) is not part of it.
That leaves both ends of the chain outside its reach — and, at any
position, a file with no hash lines, which the walk skips as `verify`
does; the list below names the measured cases, not every possible one —
and the following SHALL NOT be refused: at the head, an edit to the first migration's
`parent-snapshot:` line (the root is taken as given, the same rule
cli-commands' `verify` states) and the removal of the first migration or
of any leading run of migrations; at the tail, an edit to the last
migration's `snapshot:` line and the removal of the last migration or
of any trailing run. Each passes the pre-flight and the connection is
opened as for an intact chain; `verify` is the command that sees the
tail cases, through the snapshot.

It SHALL also report where the chain and the ledger disagree, with each
kind of disagreement carrying its own code and its own `Next:` line: a
ledger row naming a migration the repository does not contain, and a
recorded migration the chain orders after an unrecorded one. Each of
these sends the reader somewhere no other one does, which is why they
are told apart rather than reported as one condition.

#### Scenario: An unverifiable chain opens no connection
- **WHEN** a hash-chain banner line other than the first migration's
  `parent-snapshot:` and the last migration's `snapshot:` has been
  edited, or a migration between the first and the last has been
  removed, or the order has been rearranged, and `migrate` runs
- **THEN** it fails naming the artifact whose hash no longer matches, no
  connection is opened, and no statement is sent to the database

#### Scenario: A mutation at either end of the chain passes the pre-flight
- **WHEN** the first migration's `parent-snapshot:` line or the last
  migration's `snapshot:` line has been edited, or the first or the last
  migration has been removed, and `migrate` runs
- **THEN** the chain pre-flight passes and the run proceeds to open its
  connection exactly as it would for an intact chain

#### Scenario: A ledger row with no file is reported
- **WHEN** the ledger records a migration the repository does not
  contain
- **THEN** it is reported with its own code and a `Next:` line, distinct
  from the code for a migration recorded out of chain order

#### Scenario: A migration recorded out of chain order is reported
- **WHEN** the ledger records a migration the chain orders after one it
  does not record
- **THEN** that is reported with its own code and its own `Next:` line,
  and nothing is applied on top of it

### Requirement: What the ledger holds can be read without applying anything
The CLI SHALL provide a `status` command that reports, without changing
the database: the migrations the ledger records as applied, the
migrations on disk it does not record, and the disagreements the
requirement above enumerates.

`status` SHALL require no driver capability beyond reading, because it
opens no transaction and applies nothing — the trade the apply path
makes is not one this command needs to make. Its exit code SHALL
distinguish a clean answer from one that found a disagreement, so a
caller automating it can tell them apart without parsing the report.

#### Scenario: Pending migrations are reported without being applied
- **WHEN** `status` runs against a database whose ledger records the
  first two migrations of a chain of four
- **THEN** it names the two it records and the two it does not, and the
  database is unchanged afterwards

#### Scenario: A disagreement is reported by status too
- **WHEN** the ledger records a migration the repository does not
  contain and `status` runs
- **THEN** it reports that disagreement with the same code the apply
  path uses for it, and exits non-zero

### Requirement: A failure names the file, the database's own reason, and the next command
When applying fails, the report SHALL name the migration that failed,
carry the database's own error code and message, and end with a `Next:`
line naming a command. The engine applies whole files, so it reports the
file rather than a statement offset; the database's message is specific
enough to act on and is passed through rather than summarized.

Where the database refuses a migration that adds an enum value and uses
that value in the same transaction, the report SHALL translate that
refusal into hejbro's own terms: the migration was written before the
generator separated those statements, and regenerating it produces two
migrations that apply.

#### Scenario: The failure names the file and the server's reason
- **WHEN** applying a migration fails
- **THEN** the report names that migration, includes the database's own
  code and message, and gives a `Next:` line

#### Scenario: An enum value used in the transaction that added it is explained
- **WHEN** a migration adds an enum value and references that value, and
  applying it is refused
- **THEN** the report states that the two belong in separate migrations
  and names regeneration as the next step

### Requirement: A reset destroys only what the declarations manage
The CLI SHALL provide a command that returns a database to the state
before any migration was applied, insofar as the declarations still
describe what was applied, and it SHALL drop only objects the
declarations describe. Objects the declarations do not cover are
reported as inventory elsewhere in this product on the stated grounds
that a project may legitimately leave objects unmanaged; a reset that
dropped them would destroy what this tool says it does not own. When an
applied object is no longer declared, these two SHALLs bind reset to the
second one: a survivor from the drifted object collides with the chain
the next `migrate` re-applies, and that collision is the drift's own
consequence, not a defect in either SHALL.

Before evaluating anything else, reset SHALL refuse a declaration set
that describes no objects, with its own coded error, before any
statement reaches the database — the same misconfiguration `check` and
`baseline` already refuse, naming the entry point as what to check.

Reset SHALL refuse unless the destruction is confirmed explicitly, and
the refusal SHALL name what would be dropped. The confirmation SHALL be
an exact `<database>:<count>` token, supplied via `--confirm-drop` and
bound to the connected database's own name — queried live, never
assumed from configuration — and the number of objects that would be
dropped; binding it to the database's own name is what stops a
confirmation learned against one database from silently passing,
unchanged, against a different one with the same object count.

A run computing no changes needs no confirmation, since there is nothing
to name — but the refusal above already keeps that state unreachable:
every registered object kind reports a drop whenever it disappears from
a non-empty declaration set (code-certain, not verified by execution),
so a declaration set that survives the refusal above can never diff to
zero changes. The ledger is therefore cleared only together with the
drops it records, so no unconfirmed destructive path remains.

Where more than one declared object would be dropped, the order SHALL be
the reverse of the dependency order the snapshot itself describes — never
`cascade`, which could remove an object the declarations do not describe
and so would break the first paragraph's own promise. This order SHALL
hold both across kinds (a view, a policy, a trigger, and a sequence, all
before their own table — for the sequence at the statement level, since
the column default it backs is dropped by a statement of its own; a table
before its own schema) and within a kind,
for a foreign key from one declared table to another: a table that
references another declared table SHALL drop before the table it
references, so a declared object is never dropped while another object
this same run is also dropping still depends on it existing. Where two
declared tables reference each other, no order satisfies both, so they
SHALL drop in their existing identity order instead, and a resulting
refusal from the database is reported through the coded failure the next
paragraph states.

This is the same dependency graph generation computes (cli-commands),
read in the opposite direction — a dependent before what it depends on —
never the literal reverse of whatever statement sequence one specific
generation run happened to emit.

A drop that fails SHALL leave the database and the ledger exactly as
they were: the drops and the ledger's own clearing run inside one
transaction, so a failure partway through rolls all of it back, and the
failure SHALL be reported as a hejbro-coded error carrying the
database's own reason — never surfaced as an unclassified, uncaught
failure.

After a reset, the ledger SHALL hold no row for a migration whose
objects were dropped, so the next run applies the chain from its
beginning.

A database whose declared objects were applied outside hejbro — `psql
-f`, an external pipeline, both apply paths this product documents —
has no ledger table at all, and a reset there SHALL still drop every
object the declarations manage. A reset SHALL report what it did: one
that cleared no ledger SHALL NOT say it cleared one.

#### Scenario: An unmanaged table survives a reset
- **WHEN** a database holds a declared table and a table no declaration
  covers, and reset runs
- **THEN** the declared table is dropped and the unmanaged one is left
  standing

#### Scenario: An empty declaration set is refused before anything is sent
- **WHEN** `reset` runs on a project whose declarations load but export
  nothing
- **THEN** it fails with its own coded error, and no statement reaches
  the database

#### Scenario: Reset refuses without confirmation
- **WHEN** reset runs without the confirmation it requires
- **THEN** it refuses with a coded error naming what it would have
  dropped, and drops nothing

#### Scenario: A reset clears the ledger for what it dropped
- **WHEN** reset completes and `migrate` runs afterwards
- **THEN** the chain is applied from its first migration

#### Scenario: A referencing table drops before the table it references
- **WHEN** a database holds two declared tables in their own declared
  schema, one carrying a foreign key to the other, and `reset` runs with
  the confirmation it requires
- **THEN** all three objects — both tables and the schema — are gone
  afterward and the run exits zero, whichever order their names would
  otherwise sort in

#### Scenario: A failed drop leaves the ledger and status telling the truth
- **WHEN** a drop `reset` sends fails — for example, an object outside
  the declarations still depends on the one being dropped
- **THEN** `reset` exits non-zero with a coded error carrying the
  database's own reason, the database is unchanged, and `hejbro status`
  run afterward still reports every previously-applied migration as
  applied

#### Scenario: A reset drops the declared objects on a database with no ledger table
- **WHEN** a database holds the declared objects, they were applied
  without hejbro so the ledger table was never created, and `reset`
  runs with the confirmation it requires
- **THEN** the declared objects are gone afterward, the run exits zero,
  and the report does not claim a ledger was cleared

### Requirement: A database can be raised from a snapshot SQL file
The CLI SHALL provide a command that takes a snapshot SQL file and an
empty database and produces the schema that file describes. The file is
named by a required `--file` flag, with no fallback — unlike a database
connection, there is no ambient source for which file to raise from. The
file's origin is not part of the contract: that a consumer repository
commonly receives one from elsewhere is a convention, not a coupling.

Raising over a database this tool has already recorded history for
SHALL be refused before anything runs, by that history alone, and this
layer leaves nothing behind: no statement is sent, and no object of
hejbro's own is created.

Raising over a database holding an object this tool did not create but
has no record of is a collision this command cannot see in advance
without reading the catalog, which it does not do; that case SHALL
instead be refused net of a rolled-back attempt — the file's statements
are sent inside the same transaction the successful path uses, and the
server's own "already exists" failure is translated into this refusal
rather than shown raw. The target's own declared objects are absent
afterward and nothing from the file is left applied — but this layer's
refusal is not free of side effects the way the first is: the ledger's
own bootstrap runs once, idempotently, outside that transaction (so the
same successful path can write its own ledger row inside it), and that
bootstrap has already run by the time the collision is discovered. A
database refused this way is therefore left holding an empty
`hejbro.migration_ledger` table and the `hejbro` schema it lives in,
even though none of the file's own objects were created.

The ledger SHALL record how the database was raised, with the `raised`
origin (defined above), so a database created this way is not mistaken
for one no migration has ever reached.

#### Scenario: An empty database is raised from a snapshot file
- **WHEN** `raise` runs against an empty database with a snapshot SQL
  file
- **THEN** the schema the file describes exists afterwards and the
  ledger records how it was raised

#### Scenario: A non-empty database is refused
- **WHEN** `raise` runs against a database that already holds declared
  objects
- **THEN** it refuses with a coded error, and the file's own objects are
  absent afterward
