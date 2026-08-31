# schema-manifest (delta)

## ADDED Requirements

### Requirement: A migration can carry the schema it produced
hejbro SHALL support emitting a **schema manifest** as part of a
generated migration: statements that create a manifest table if it does
not exist and insert exactly one row describing the schema that
migration leaves behind. Emission SHALL be opt-in, and with it disabled
a generated migration SHALL be byte-identical to what the same
declarations produce with the capability absent.

hejbro SHALL write these statements and SHALL NOT execute them. No
command acquires a database connection in order to record a manifest
row; the row appears when the user's own apply tool runs the migration,
alongside the schema change it describes, or not at all.

A run that finds no difference writes no migration, so it records no
manifest row either: a manifest row exists only where a schema change
exists.

#### Scenario: Enabled emission appends the manifest statements
- **WHEN** manifest emission is enabled and a migration is generated for
  a schema change
- **THEN** the migration file contains the manifest table bootstrap and
  one insert, after the statements that make the change

#### Scenario: Disabled emission changes nothing
- **WHEN** manifest emission is disabled and a migration is generated
- **THEN** the migration SQL is byte-identical to the same generation
  with no manifest support present, and carries no manifest banner line

#### Scenario: Recording a manifest opens no connection
- **WHEN** a migration carrying manifest statements is generated
- **THEN** generation completes with no database connection, and the
  database holds no new row until the migration is applied

#### Scenario: The embedded snapshot is the snapshot written beside it
- **WHEN** a migration carrying manifest statements is generated
- **THEN** the snapshot embedded in its payload is the same snapshot the
  same run writes to disk, so reading either one is reading both

#### Scenario: No change records no manifest
- **WHEN** manifest emission is enabled and generation finds no
  difference between the declarations and the snapshot
- **THEN** nothing is written and no manifest row can result

### Requirement: The emitted manifest statements are deterministic
Manifest statements SHALL preserve generation's byte-determinism: the
same declarations against the same snapshot SHALL produce byte-identical
migration SQL however much time passes between runs and whatever the
migration file is named. Therefore the emitted statements SHALL contain
no value derived from a clock and no value derived from the migration's
file name. The row's application time SHALL come from the manifest
table's own column default, evaluated by the server when the migration
is applied.

The payload SHALL be serialized by the same stable serialization the
snapshot itself uses, so that key order and numeric formatting are fixed
by one rule rather than by two.

#### Scenario: Two runs separated in time are byte-identical
- **WHEN** a migration carrying manifest statements is generated twice
  from the same declarations and the same prior snapshot, with the clock
  advanced between the runs
- **THEN** both runs produce byte-identical migration SQL

#### Scenario: The statements name no clock and no file
- **WHEN** a migration carrying manifest statements is generated
- **THEN** the inserted values contain no timestamp literal and no
  migration file name, and the row's application time is supplied by the
  table's column default

### Requirement: The bootstrap is idempotent and precedes the insert
Every migration that carries manifest statements SHALL carry the table
bootstrap ahead of its insert, and the bootstrap SHALL be idempotent, so
that applying a chain that begins at any of its migrations creates the
manifest table before writing to it. A chain SHALL never depend on which
migration was applied first.

#### Scenario: A chain applied from its beginning succeeds
- **WHEN** a chain whose migrations carry manifest statements is applied
  in order against an empty database, with the apply stopping on the
  first error
- **THEN** every migration applies and the manifest table holds one row
  per applied migration

#### Scenario: A chain applied from a later point succeeds
- **WHEN** the same chain is applied starting from a migration that is
  not the first, against a database that already has the earlier schema
  and no manifest table
- **THEN** that migration creates the manifest table before inserting
  its row

### Requirement: A manifest row carries what a database cannot be asked
A manifest row SHALL carry the snapshot of the schema as of that
migration, plus the declaration-time choices a consuming repository's
type layer needs that are recoverable from neither the database nor the
snapshot. Those choices are: **a column's numeric mode**, **whether an
array column's elements are constrained non-null**, **a column's
TypeScript key**, **the name each declaration was exported under** —
for tables, because a reverse relation key is that name, and for
functions, because a typed function call is keyed by it — and **the role
names the schema declares in its grants and policies**. The export names
of views, enums, schemas and grants are not carried, because none of
them appears in a consuming repository's types.

Every fact that belongs to a column SHALL be carried against that
column's SQL name, never against its position. The snapshot records
columns in the table's physical order and a declaration lists them in
the order they were written; those two agree until a column is dropped
and re-added, and a reader that joined them by position would from then
on attach each fact to the wrong column while every type still looked
right.

A declaration that was never a module export has no export name to
carry: a function synthesized as part of a trigger definition is in the
snapshot but was never exported, so nothing downstream can offer it as
something the owning repository itself has.

A function's export name is carried even though no reader emits function
declarations yet. Carrying it now costs one entry in a map that is
already being built; adding it later would move the manifest format, and
a reader that meets a format higher than it knows refuses — so the cheap
moment to carry a fact is before anything depends on not having it.

Four kinds of declaration-time information are deliberately outside the
set, each for its own reason: a column's declared length, precision and
scale reach the snapshot through the type, so they are recoverable; the
read type of a date, timestamp or serial column is fixed by its type
rather than chosen, so there is nothing to record; the export names of
views, enums, schemas and grants never appear in a consuming
repository's types; and a relation key cannot be named by hand, so there
is no alias to carry.

One declaration-time choice is deliberately not carried. A `$type` brand
leaves nothing readable where the migration is generated, since it
changes a type and no value, and the TypeScript type it names does not
exist in a consuming repository at all. Its absence is a contract,
stated by the requirement that brands do not cross the boundary, not an
omission.

A row SHALL also carry two version numbers as separate values — the
format of the manifest itself and the format of the snapshot it embeds —
because they move independently, and a reader that cannot tell them
apart would misjudge one when the other changed.

A row SHALL be self-contained: reading it SHALL require no other row.

#### Scenario: A brand is not among the carried facts
- **WHEN** a schema declaring a `$type` brand is emitted as a manifest
  row
- **THEN** the row carries no brand information, and the carried facts
  are unaffected

#### Scenario: The carried choices survive the round trip
- **WHEN** a schema declaring a numeric column with a non-default mode,
  an array column with non-null elements, columns whose TypeScript keys
  differ from their SQL names, tables and functions exported under names
  that differ from their SQL names, and roles named in grants and
  policies is emitted as a manifest row and read back
- **THEN** every one of those choices is recovered exactly as declared,
  each against the SQL name of the column it belongs to

#### Scenario: A re-added column keeps its own facts
- **WHEN** a table whose physical column order differs from its
  declaration order — one column having been dropped and added again —
  is emitted as a manifest row and read back
- **THEN** each column's facts are the ones it was declared with, not
  the ones belonging to whatever column sits at the same position

#### Scenario: A synthesized trigger function carries no export name
- **WHEN** a schema whose only function declarations come from trigger
  definitions is emitted as a manifest row
- **THEN** the row carries no export name for them

#### Scenario: The two format versions are separate
- **WHEN** a manifest row is read
- **THEN** the manifest's own format and the embedded snapshot's format
  are available as distinct values

#### Scenario: A row is readable alone
- **WHEN** the newest manifest row is read and no other row is available
- **THEN** the schema it describes is fully recoverable

### Requirement: The database owns the order of manifest rows
The manifest table SHALL order its rows by a value the database assigns
on insert, not by any value the migration supplies. A reader SHALL
determine how far a given row is from the newest row by counting the
rows that follow it.

#### Scenario: Distance is counted, not inferred from time
- **WHEN** three migrations are applied and a reader holds the schema
  from the first
- **THEN** the reader determines it is two rows behind, without
  consulting any timestamp

### Requirement: A chain that carries manifests keeps carrying them
Once a migration chain contains a migration that carries manifest
statements, hejbro SHALL refuse to generate a migration for that chain
with manifest emission disabled, with a coded error whose remedy is to
enable emission again. Verification SHALL report the same condition for
a chain on disk, so that removing the statements by hand is caught
without a database.

Silently stopping would leave the database's newest manifest row
describing an older schema while every freshness check downstream
reported agreement — a stale answer that reads as a fresh one.

#### Scenario: Generating with emission turned back off is refused
- **WHEN** a chain already contains a migration carrying manifest
  statements and generation runs with manifest emission disabled
- **THEN** generation fails with a coded error naming the condition, and
  no migration is written

#### Scenario: A hand-edited chain is caught without a database
- **WHEN** the manifest statements are removed from a migration in a
  chain whose later migrations carry them, and verification runs
- **THEN** verification reports the chain as no longer carrying its
  manifests

#### Scenario: Enabling again succeeds
- **WHEN** generation runs for that chain with manifest emission enabled
- **THEN** generation proceeds normally

### Requirement: A migration announces its manifest format in the banner
A migration carrying manifest statements SHALL record the manifest
format in its banner as a line with its own prefix, so that a tool can
learn what the file carries without parsing its SQL. Readers that do not
know this line SHALL ignore it, as they ignore any banner line whose
prefix they do not know.

#### Scenario: The line is readable by its prefix
- **WHEN** a migration carrying manifest statements is parsed for its
  banner
- **THEN** the manifest format is available from its own line, and the
  banner's other lines parse as before

#### Scenario: A reader that does not know the line is unaffected
- **WHEN** a parser that knows only the pre-existing banner lines reads
  a migration carrying the manifest line
- **THEN** it reads its own lines and ignores the manifest line

### Requirement: The payload is embedded so that it cannot be misread
The payload SHALL be embedded in the insert in a form whose meaning does
not depend on server configuration. Where the chosen form has a
terminator that could occur inside the payload, generation SHALL refuse
with a coded error rather than emit a statement that could parse
differently from how it reads.

#### Scenario: A payload that could break out is refused
- **WHEN** a payload would contain the sequence that terminates its own
  quoting
- **THEN** generation fails with a coded error and writes nothing

### Requirement: A baseline migration carries no manifest row
A baseline migration is registered as applied rather than run, so any
manifest statements inside it would never execute. hejbro SHALL NOT emit
manifest statements into a baseline migration, and the baseline report
SHALL state that the database will hold no manifest row until the next
generated migration is applied.

#### Scenario: A baseline carries no manifest statements
- **WHEN** a baseline migration is generated with manifest emission
  enabled
- **THEN** the file contains no manifest statements and no manifest
  banner line

#### Scenario: The baseline report says what is missing
- **WHEN** that baseline is reported
- **THEN** the report states that no manifest row will exist until the
  next migration is applied
