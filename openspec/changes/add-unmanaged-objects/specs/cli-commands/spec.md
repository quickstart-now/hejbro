# Delta: cli-commands

## ADDED Requirements

### Requirement: The apply commands leave existing declarations alone
`hejbro check` SHALL compare nothing about an existing table — one the
schema declares with `existingTable()` — and SHALL NOT list it in the
unmanaged inventory. That inventory's sense of *unmanaged* is a table no
declaration covers, and an existing declaration covers one: it claims a
shape hejbro does not own. Its presence or absence in the database SHALL
NOT affect the exit code.

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

#### Scenario: baseline and reset pass an existing declaration by
- **WHEN** a schema declaring a table with `existingTable()` is
  baselined, and a later `hejbro reset` runs against it
- **THEN** the baseline migration carries no statement for that table,
  and the reset drops nothing of it

## MODIFIED Requirements

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
that produces a **different** snapshot but no migration SHALL write the
snapshot, write no migration, report that the snapshot was updated with
no migration to write, and exit zero. That second case is what a
declaration hejbro records but never emits produces: whether a run has
something to write is decided by comparing the snapshot it arrived at
against the previous one, never by whether the migration SQL came out
empty.

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

#### Scenario: A recorded declaration that emits nothing still writes the snapshot
- **WHEN** an `existingTable()` declaration is added to a repository
  whose snapshot already matches its declarations, and `hejbro generate`
  runs
- **THEN** no migration is written, the snapshot is written with the
  table recorded as existing, the report says so, and the exit code is
  zero

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

