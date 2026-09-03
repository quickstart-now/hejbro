## MODIFIED Requirements

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
satisfies — keeps its existing identity order. A reset's drops are the
reverse of this order (migration-apply). The migration's own name SHALL
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
