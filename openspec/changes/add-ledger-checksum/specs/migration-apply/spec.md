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
recorded below, the timestamp the database assigned it, and the
checksum of the body that ran — the SHA-256 of the text below the
banner block with line endings normalized, or of the whole file for a
raised snapshot — so the ledger can later say whether the file on disk
is the file that ran. The bootstrap SHALL create the checksum column and
SHALL add it to a ledger written before the column existed; a row
recorded then carries no checksum and is never compared.

The ledger is recognized by identity, never by existence alone. The
relation at that name is hejbro's ledger only when it is an ordinary,
logged table whose columns include the four the bootstrap creates —
`id`, `filename`, `origin` and `applied_at` — each carrying the type the
bootstrap gave it; a column beyond those four does not disqualify it.
Anything else at that name — a table missing one of them or carrying one
under another type, an unlogged table (hejbro never creates one, and a
table whose rows vanish on a crash cannot hold the record of what was
applied), a leaf partition or an inheritance child (both are tables in
the catalog, neither is a table hejbro created), a view, a materialized
view, a foreign table, a sequence, a partitioned table, a composite
type, an index — is not the ledger, and
SHALL be treated as an object hejbro did not create: never read as a
ledger, never written, never cleared. The refusal names the kind of
object in words — every relation kind the catalog can hold at that name
has its own — never the catalog's own one-letter code, and, for a
relation that carries columns, the columns found. The judgement is one catalog read that opens no
transaction and needs no privilege beyond reading the catalog, and it is
one judgement: every command that touches the ledger — `migrate`,
`status`, `reset` and `raise` — makes it once, before reading or writing
anything there, and refuses with the one shared code
`apply-ledger-occupied`, naming the kind of object found and, where it
carries columns, the columns found, ending with a `Next:` line. `migrate` SHALL make it
before its bootstrap runs — the bootstrap's own `create table if not
exists` skips over any relation at that name with a notice, and the run
would otherwise write hejbro's rows into a table it never created — and
SHALL exit two, the answer for a run that could not act at all. What
`status`, `reset` and `raise` do with the judgement is stated in their
own requirements below.

The judgement above needs no privilege beyond reading the catalog, so
answering "this is hejbro's ledger" says nothing about whether this
connection may read or write it. **Reading the ledger SHALL fail in
hejbro's own terms or not at all.** The relation's absence is a state and
not a failure — a ledger that does not exist is a database hejbro has
never applied to, reported as the paragraph on absent-versus-empty below
states, and it stays that state whether the relation was absent all along
or vanished between the judgement and the read; the server gives one
answer for a missing table and for a missing schema alike, so hejbro
reads one answer for both. Every other answer the server gives to a read
hejbro sends to the ledger — a role that may connect but may not select
from the table, a schema whose `usage` is withheld, a failure carrying no
server code at all — SHALL be reported with the one shared code
`apply-ledger-unreadable`, naming the ledger by its qualified name, the
role the connection authenticated as (read on a fresh connection once
the failing one is discarded, omitted only when no connection can answer
for it), and the server's own code and message unsummarized, ending
with a `Next:` line whose remedy fits the reason: a refused permission
offers both ways out — grant that role what the read needs, or connect
as the role that applied — while a connection that died, a cancelled
statement or a failure carrying no server code offers a rerun once the
server answers, since no grant fixes those. No error the server raised on the ledger SHALL reach the user as
a driver object or a stack trace, on any command that reads it —
`status`, `migrate` and `raise` — and the rule is one rule, made where
the read is sent rather than at each command that sends one.

**Writing the ledger SHALL fail in hejbro's own terms too**, under its
own code `apply-ledger-unwritable`, naming the ledger, the role, the
server's own code and message, and which write was refused: the bootstrap
that creates the ledger, the row that records a migration, or the
clearing of its rows. Read and write carry different codes because they
send the reader to different places — a read is answered by a grant or by
another role, a write is answered by that *and* by the shape of the
ledger itself, which a database may have altered under hejbro (a `id`
column left without the identity the bootstrap gave it is the measured
case). A refused write is never charged to whatever the run was doing at
the time: a migration whose statements the database accepted and whose
ledger row it refused has applied nothing, because the two are one
transaction and it rolled back, and the report SHALL say the rollback
happened rather than name that migration as the migration that failed.

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
— an unverifiable chain, a ledger disagreement, a ledger it may not read
or write, or a missing connection, driver or capability. A ledger
failure is two and not one: one is reserved for the database refusing a
*migration*, which is the one thing a ledger failure proves did not
happen. Its report SHALL name, in their own buckets, the
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
  a sequence, a partitioned table carrying the same four columns, an
  unlogged table carrying the same four columns, a leaf partition or an
  inheritance child carrying the same four columns, a composite type,
  an index, or a partitioned index
- **THEN** the first is judged the ledger and every one of the others is
  judged not to be, by the one judgement `migrate`, `status`, `reset`
  and `raise` share, none of the others is read, written or cleared as
  a ledger, and each refusal names that kind of object in words — with
  the columns found where the relation carries columns, and no column
  list for a sequence or an index

#### Scenario: migrate refuses a relation that is not the ledger before bootstrapping
- **WHEN** a table of another shape — even one carrying the ledger's
  four column names — or a view sits at `"hejbro"."migration_ledger"`,
  and `migrate` runs with migrations pending
- **THEN** it exits two with `apply-ledger-occupied`, no migration
  statement is sent, nothing is written into that relation, and it is
  left exactly as it was

#### Scenario: A ledger the connected role may not read is reported in hejbro's own terms
- **WHEN** hejbro's own ledger sits at the ledger's name and the server
  refuses hejbro's read of it — the role's `select` on the table
  withheld, or the schema's `usage` withheld — and `status`, `migrate` or
  `raise` runs
- **THEN** each fails with `apply-ledger-unreadable`, naming the ledger,
  the role the connection authenticated as, and the server's own code and
  message, ending with a `Next:` line, and no driver object and no stack
  frame reaches the user

#### Scenario: A ledger write the database refuses is attributed to the ledger
- **WHEN** the ledger's own write is refused — the bootstrap's `create`
  refused to a role without it, a recorded row refused because the
  ledger's `id` carries neither identity nor default, because the role's
  `insert` is withheld, because the filename is already recorded, or
  because a constraint or trigger on the ledger rejects the row, or the
  clearing of its rows refused — and the command that sent it was
  `migrate`, `raise` or `reset`
- **THEN** each fails with `apply-ledger-unwritable`, naming the ledger,
  the role, which write was refused and the server's own code and
  message, ending with a `Next:` line, and no migration file and no
  declared object is named as the thing that failed

### Requirement: A migration is applied atomically with its own ledger row
Each migration SHALL be applied inside one transaction that also writes
its ledger row, so that a database never holds a migration the ledger
does not record, nor a row for a migration that did not fully apply. The
row SHALL carry the checksum of the body that was sent, computed from
the same text.

The migration's statements SHALL be sent as a single statement text
carrying no parameters. A parameter turns the same text into a prepared
statement, which refuses to carry more than one command; the ledger row
is written by its own statement inside the same transaction, where
parameters are available because it is one command.

A run that fails SHALL stop at the failing migration and leave the
migrations before it applied and recorded. Partial application *within*
a migration does not occur and SHALL NOT be modelled: there is no state
in which some of a migration's statements are applied.

The two halves of that transaction fail under different codes. Neither
leaves anything behind — that is what the one transaction is for — but
each sends the reader somewhere the other does not, so the migration's
own statements failing SHALL be reported as `apply-failed` naming that
file, and the ledger row failing SHALL be reported as
`apply-ledger-unwritable` naming the ledger, with the rollback stated so
a reader knows the migration is not half-applied. Which half failed SHALL
be established structurally — by which statement the failure came back
from — never by matching the failure's message or by reading the SQL text
back.

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

#### Scenario: The half that failed decides which artifact is named
- **WHEN** a migration whose own statement the database refuses is
  applied, and separately a migration whose statements the database
  accepts but whose ledger row it refuses
- **THEN** the first is reported with `apply-failed` naming that
  migration file and the second with `apply-ledger-unwritable` naming the
  ledger and stating the rollback, and after either the objects that
  migration would have created do not exist and the ledger holds no row
  for it

### Requirement: A baseline is registered rather than run
A migration carrying the baseline marker describes objects that already
exist. The apply path SHALL record it in the ledger with the
`registered` origin, without executing its statements — never the
`applied` origin, which is reserved for a migration whose statements
were actually sent — and SHALL read the marker through the exported
parser rather than by matching the banner's text. The row SHALL carry
the checksum of the baseline's body, the text the database is taken to
already hold.

#### Scenario: A baseline migration is recorded without being executed
- **WHEN** a chain whose first migration carries the baseline marker is
  applied to the database it describes
- **THEN** no statement from that migration is sent, the ledger records
  it with the `registered` origin, and the migrations after it apply
  normally

### Requirement: What the ledger holds can be read without applying anything
The CLI SHALL provide a `status` command that reports, without changing
the database: the migrations the ledger records as applied, the
migrations on disk it does not record, the disagreements the
requirement above enumerates, and every recorded migration whose body
on disk no longer hashes to the checksum the ledger holds — reported as
its own line, never as "applied".

`status` SHALL require no driver capability beyond reading, because it
opens no transaction and applies nothing — the trade the apply path
makes is not one this command needs to make. Its exit code SHALL
distinguish a clean answer from one that found a disagreement, so a
caller automating it can tell them apart without parsing the report.

When the relation at the ledger's name is not the ledger — by the
identity the first requirement of this capability states — `status`
SHALL refuse with `apply-ledger-occupied`, the code every ledger-touching
command uses for the same finding, naming the kind of object found and,
where it carries columns, the columns found, ending with a `Next:` line,
and SHALL exit non-zero. No
error the database raised at the ledger's name SHALL reach the user raw,
whichever of the two findings produced it: for a relation that is not the
ledger, the finding is what sits at the name, not the failure of a read
hejbro should never have attempted; for the ledger itself, when the
server refuses hejbro's read of it, `status` SHALL report
`apply-ledger-unreadable` as the first requirement states and SHALL exit
non-zero. A read-only command is the one a user reaches for to find out
what is wrong, so it is the last place a raw driver failure may surface.

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
  kind of object it found and, where it carries columns, the columns
  found, gives a `Next:` line, and prints no raw database error and no
  stack trace

#### Scenario: status reports a ledger it may not read
- **WHEN** hejbro's own ledger sits at the ledger's name, the connected
  role may not read it, and `status` runs
- **THEN** it exits non-zero with `apply-ledger-unreadable`, names the
  ledger, the role and the server's own code and message, gives a `Next:`
  line, and prints no raw database error and no stack trace

#### Scenario: A changed body is reported by status
- **WHEN** a recorded migration's body on disk differs from what ran and
  `status` runs
- **THEN** it reports that file as changed since it was applied, with
  the same code `migrate` refuses under, and exits non-zero

## ADDED Requirements

### Requirement: An applied migration whose body changed is refused
Before applying anything pending, `migrate` SHALL hash the body of every
recorded migration present on disk the way the ledger hashed it and
compare it with the checksum the ledger holds; a mismatch SHALL be
refused with `apply-migration-body-changed` before any statement is
sent, naming the file, the recorded and the current checksum, and the
remedy — restore the file from version control, or write a deliberate
change as a new migration; hejbro never rewrites applied history. A row
recorded before the checksum column existed carries none and is not
compared. The offline walk (`verify`) keeps its stated limit: it never
sees a body edit; this apply-time check is the half that does, and the
generate/verify reference says which half answers which question.

#### Scenario: An edited applied body refuses the run before anything is sent
- **WHEN** the first of two recorded migrations has a statement appended
  below its banner, a third migration is pending, and `migrate` runs
- **THEN** it fails with `apply-migration-body-changed` naming the
  first file and both checksums, the third migration is not applied,
  and the ledger is unchanged

#### Scenario: A line-ending change is not an edit
- **WHEN** a recorded migration is checked out with `\r\n` line endings
  and `migrate` runs
- **THEN** its checksum matches and the run proceeds

#### Scenario: A row without a checksum is not compared
- **WHEN** the ledger was written before the column existed, the
  bootstrap adds the column, and `migrate` runs with a pending migration
- **THEN** the older rows are not compared, the pending migration
  applies and its row carries a checksum

#### Scenario: A raised database records the whole file's checksum
- **WHEN** `raise --file snapshot.sql` succeeds
- **THEN** the ledger row carries the SHA-256 of the whole file

### Requirement: A ledger whose rows are filtered is refused
hejbro never enables row-level security on its own ledger, so a
relation at the ledger's name that carries row-level security — enabled
or forced — is a ledger whose rows may be hidden from the connecting
role, and reading it would answer "nothing applied" for a database
that applied everything. Every command that touches the ledger —
`migrate`, `status`, `reset` and `raise` — SHALL make that judgement
where it makes the identity judgement, from the catalog, before any row
is read, and SHALL refuse with `apply-ledger-filtered`, naming the
ledger, the connecting role and the policies the catalog holds on it,
ending with a `Next:` line naming both ways out: disable row-level
security on the ledger, or connect as the role that applied the chain.

#### Scenario: A ledger under forced row-level security is refused before it is read
- **WHEN** row-level security is forced on `"hejbro"."migration_ledger"`
  with a policy that hides its rows from the connecting role, and
  `status` and `migrate` each run
- **THEN** each exits non-zero with `apply-ledger-filtered`, naming the
  ledger, the role and the policy, no ledger row is read and nothing
  is applied — never an empty ledger and a chain re-applied from the
  start
