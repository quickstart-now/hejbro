## MODIFIED Requirements

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

The ledger is recognized by identity, never by existence alone. The
relation at that name is hejbro's ledger only when it is an ordinary
table whose columns include the four the bootstrap creates — `id`,
`filename`, `origin` and `applied_at` — each carrying the type the
bootstrap gave it; a column beyond those four does not disqualify it.
Anything else at that name — a table missing one of them or carrying one
under another type, a view, a materialized view, a foreign table, a
sequence, a partitioned table — is not the ledger, and SHALL be treated
as an object hejbro did not create: never read as a ledger, never
written, never cleared. The judgement is one catalog read that opens no
transaction and needs no privilege beyond reading the catalog, and it is
one judgement: every command that touches the ledger — `migrate`,
`status`, `reset` and `raise` — makes it once, before reading or writing
anything there, and refuses with the one shared code
`apply-ledger-occupied`, naming the kind of object found and the columns
it carries and ending with a `Next:` line. `migrate` SHALL make it
before its bootstrap runs — the bootstrap's own `create table if not
exists` skips over any relation at that name with a notice, and the run
would otherwise write hejbro's rows into a table it never created — and
SHALL exit two, the answer for a run that could not act at all. What
`status`, `reset` and `raise` do with the judgement is stated in their
own requirements below.

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

#### Scenario: The ledger is told from another relation at its name
- **WHEN** the relation at `"hejbro"."migration_ledger"` is an ordinary
  table carrying the four bootstrap columns with their types — with or
  without further columns — and separately when it is a table missing
  one of them or carrying one under another type, a view (even one
  whose columns match the four), a materialized view, a foreign table,
  a sequence, or a partitioned table carrying the same four columns
- **THEN** the first is judged the ledger and every one of the others is
  judged not to be, by the one judgement `migrate`, `status`, `reset`
  and `raise` share, and none of the others is read, written or cleared
  as a ledger

#### Scenario: migrate refuses a relation that is not the ledger before bootstrapping
- **WHEN** a table of another shape — even one carrying the ledger's
  four column names — or a view sits at `"hejbro"."migration_ledger"`,
  and `migrate` runs with migrations pending
- **THEN** it exits two with `apply-ledger-occupied`, no migration
  statement is sent, nothing is written into that relation, and it is
  left exactly as it was

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

When the relation at the ledger's name is not the ledger — by the
identity the first requirement of this capability states — `status`
SHALL refuse with `apply-ledger-occupied`, the code every ledger-touching
command uses for the same finding, naming the kind of object found and
its columns and ending with a `Next:` line, and SHALL exit non-zero. No
error the database raised on that object SHALL reach the user raw: the
finding is what sits at the name, not the failure of a read hejbro
should never have attempted.

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

#### Scenario: status refuses a relation that is not the ledger at the ledger's name
- **WHEN** a view, or any other relation that is not the ledger, sits at
  `"hejbro"."migration_ledger"` and `status` runs
- **THEN** it exits non-zero with `apply-ledger-occupied`, names the
  kind of object it found and the columns it carries, gives a `Next:`
  line, and prints no raw database error and no stack trace

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

Next, and before asking for any confirmation, reset SHALL judge the
relation at the ledger's name by the identity the first requirement of
this capability states. When it is not the ledger, reset SHALL refuse
with `apply-ledger-occupied` — the code every ledger-touching command
uses for the same finding — and SHALL send no drop and no delete: an
object hejbro did not create, sitting at hejbro's own bookkeeping name,
says this database is not the one the declarations describe, and
clearing it would destroy what the first paragraph promises to leave
alone. This refusal is a precondition of the same rank as the empty
declaration set's, and it comes before the confirmation for the same
reason: asking for a `<database>:<count>` token — naming the objects
that would be dropped — for a run that is refused anyway would be both
wasted and misleading. The judgement is one catalog read outside any
transaction, so nothing the confirmation protects is touched by making
it first. The ledger is cleared only when that judgement says it is
one; an absent relation is the no-ledger case stated further below.

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
this same run is also dropping still depends on it existing. Where
declared tables reference each other in a cycle — two of them directly,
or any number of them around one longer loop — no order satisfies every
edge, so the cycle's members SHALL drop in their existing identity order
instead, and a resulting refusal from the database is reported through
the coded failure the next paragraph states. That failure's `Next:` line
SHALL state that the declared tables themselves contain such a cycle
whenever they do, whatever its length, beside — never instead of — the
possibility that an object outside the declarations depends on one being
dropped, since the database names an object and not an edge. A table
that references only itself is not a cycle: dropping it drops its own
constraint with it.

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

#### Scenario: A reset refuses when the ledger's name is held by something else
- **WHEN** a database holds the declared objects, a table of another
  shape holding rows — or a view — sits at `"hejbro"."migration_ledger"`,
  and `reset` runs, with or without a confirmation
- **THEN** it exits non-zero with `apply-ledger-occupied` naming what it
  found, never asks for a confirmation token, every declared object is
  still standing, and the object at the ledger's name and every row it
  holds are untouched

#### Scenario: The cycle advice covers a cycle of any length
- **WHEN** three or more declared tables reference each other around one
  loop, and the database refuses the drop `reset` sends
- **THEN** the coded failure's `Next:` line states that the declared
  tables themselves form a cycle, exactly as it does for two tables
  referencing each other, and still names the outside-the-declarations
  possibility beside it

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

Before that history is even read, raise SHALL judge the relation at the
ledger's name by the identity the first requirement of this capability
states, and when it is not the ledger SHALL refuse with
`apply-ledger-occupied` — the code every ledger-touching command uses
for the same finding — leaving nothing behind the same way the history
refusal does: no statement from the file is sent, the bootstrap does not
run, and the object found is untouched.

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

#### Scenario: raise refuses a relation that is not the ledger before anything runs
- **WHEN** a view, or a table of another shape, sits at
  `"hejbro"."migration_ledger"` and `raise` runs with a snapshot SQL file
- **THEN** it exits non-zero with `apply-ledger-occupied`, no statement
  from the file is sent, no bootstrap runs, and that relation is left
  exactly as it was
