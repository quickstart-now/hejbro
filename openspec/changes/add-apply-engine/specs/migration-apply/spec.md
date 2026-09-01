# Delta: migration-apply

## Purpose

How a migration hejbro wrote reaches a database, and what is true after
it does: the order migrations are applied in, the ledger of hejbro's own
writes that records them, the transaction each one runs in, the lock
that keeps two runners apart, and what a failure leaves behind. Sibling
to `migration-format`, which says what a migration file carries; this
says what happens when one is run.

## ADDED Requirements

### Requirement: Migrations are applied in chain order, and what was applied is recorded
The CLI SHALL apply the migrations on disk that the database's ledger
does not record, in the order the chain gives them — never the order a
directory listing gives them.

A **ledger** is a table hejbro creates in the database it applies to,
holding one row per applied migration. The ledger is the record of
hejbro's own writes: it says what this tool applied, and it never
claims anything about the shape of the schema. Reading the catalog to
judge the declarations is a different question and is not part of this
capability.

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
  statement is sent

### Requirement: A baseline is registered rather than run
A migration carrying the baseline marker describes objects that already
exist. The apply path SHALL record it as applied without executing its
statements, and SHALL read the marker through the exported parser rather
than by matching the banner's text.

#### Scenario: A baseline migration is recorded without being executed
- **WHEN** a chain whose first migration carries the baseline marker is
  applied to the database it describes
- **THEN** no statement from that migration is sent, the ledger records
  it as applied, and the migrations after it apply normally

### Requirement: Applying refuses a chain that does not verify, and reports what disagrees
The apply path SHALL verify the migration chain on disk before applying
anything: applying a chain whose hashes do not agree is applying bytes
nothing vouches for, and the check needs no database.

It SHALL also report where the chain and the ledger disagree, with each
kind of disagreement carrying its own code and its own `Next:` line: a
ledger row naming a migration the repository does not contain, and a
recorded migration the chain orders after an unrecorded one. Each of
these sends the reader somewhere no other one does, which is why they
are told apart rather than reported as one condition.

#### Scenario: An unverifiable chain is not applied
- **WHEN** a migration file has been edited by hand and `migrate` runs
- **THEN** it fails naming the artifact whose hash no longer matches,
  and no statement is sent to the database

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
before any migration was applied, and it SHALL drop only objects the
declarations describe. Objects the declarations do not cover are
reported as inventory elsewhere in this product on the stated grounds
that a project may legitimately leave objects unmanaged; a reset that
dropped them would destroy what this tool says it does not own.

Reset SHALL refuse unless the destruction is confirmed explicitly, and
the refusal SHALL name what would be dropped. After a reset, the ledger
SHALL hold no row for a migration whose objects were dropped, so the
next run applies the chain from its beginning.

#### Scenario: An unmanaged table survives a reset
- **WHEN** a database holds a declared table and a table no declaration
  covers, and reset runs
- **THEN** the declared table is dropped and the unmanaged one is left
  standing

#### Scenario: Reset refuses without confirmation
- **WHEN** reset runs without the confirmation it requires
- **THEN** it refuses with a coded error naming what it would have
  dropped, and drops nothing

#### Scenario: A reset clears the ledger for what it dropped
- **WHEN** reset completes and `migrate` runs afterwards
- **THEN** the chain is applied from its first migration

### Requirement: A database can be raised from a snapshot SQL file
The CLI SHALL provide a command that takes a snapshot SQL file and an
empty database and produces the schema that file describes. The file's
origin is not part of the contract: that a consumer repository commonly
receives one from elsewhere is a convention and a configuration default,
not a coupling.

It SHALL refuse a database that already contains declared objects,
before applying anything. Raising over an existing schema is not this
command's work, and failing halfway through is the worst way to say so.

The ledger SHALL record how the database was raised, so a database
created this way is not mistaken for one no migration has ever reached.

#### Scenario: An empty database is raised from a snapshot file
- **WHEN** `raise` runs against an empty database with a snapshot SQL
  file
- **THEN** the schema the file describes exists afterwards and the
  ledger records how it was raised

#### Scenario: A non-empty database is refused
- **WHEN** `raise` runs against a database that already holds declared
  objects
- **THEN** it refuses with a coded error and applies nothing
