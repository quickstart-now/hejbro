# schema-export (delta)

## ADDED Requirements

### Requirement: A repository publishes the schema it declares
`generate` SHALL write an **export** into the repository alongside the
migration and the snapshot: a machine-readable description of the
schema as declared, the squashed SQL that raises that schema from
nothing, and a file recording the formats the other two are written in.
The export SHALL be produced from the declarations, not from a
database, so that it can be written where no database exists.

The export is committed. It is the only thing a consuming repository
ever reads, and it is readable by any tool that can read a file.

#### Scenario: Generating writes the export
- **WHEN** generation runs for a repository with the export enabled
- **THEN** the export directory holds the schema description, the
  squashed SQL and the format record, and each is a file in the
  repository

#### Scenario: The export needs no database
- **WHEN** generation runs with no database reachable
- **THEN** the export is written in full

#### Scenario: A repository without the export is unchanged
- **WHEN** generation runs with the export disabled
- **THEN** the migration and the snapshot are byte-identical to what
  the same declarations produce with this capability absent

### Requirement: The export is a function of the declarations
The same declarations SHALL produce a byte-identical export, on any
machine and at any time. The export SHALL therefore contain no value
derived from a clock, from the machine, or from the order in which
files happened to be read, and SHALL be serialized by the same stable
serialization the snapshot uses, so that key order and number
formatting are fixed by one rule rather than by two.

Determinism carries more weight here than it did for a migration: the
export is committed and reviewed as a diff, so an emitter that reorders
its output on a different machine turns every unrelated pull request
into a review of noise.

#### Scenario: Two runs separated in time are byte-identical
- **WHEN** the export is written twice from the same declarations, with
  the clock advanced between the runs
- **THEN** both runs produce byte-identical files

#### Scenario: The export names no clock and no machine
- **WHEN** the export is written
- **THEN** it contains no timestamp, no host name, and no absolute path

### Requirement: The export carries what the schema alone does not say
The schema description SHALL carry the snapshot of the declared schema
plus the declaration-time choices a consuming repository's type layer
needs and the snapshot does not record. Those choices are: **a column's
numeric mode**, **whether an array column's elements are constrained
non-null**, **a column's TypeScript key**, **the name each declaration
was exported under** — for tables, because a reverse relation key is
that name, and for functions, because a typed call is keyed by it — and
**the role names the schema declares in its grants and policies**.

Every fact that belongs to a column SHALL be carried against that
column's SQL name, never against its position. The snapshot records
columns in physical order and a declaration lists them in the order
they were written; those agree until a column is dropped and added
again, and a reader joining them by position would from then on attach
each fact to the wrong column while every type still looked right.

A declaration that was never a module export has no export name to
carry: a function synthesized as part of a trigger definition is in the
snapshot but was never exported, so nothing downstream can offer it as
something the owning repository itself has.

One declaration-time choice is deliberately not carried. A `$type`
brand leaves nothing readable where the export is written, since it
changes a type and no value, and the TypeScript type it names does not
exist in a consuming repository at all.

#### Scenario: The carried choices survive the round trip
- **WHEN** a schema declaring a numeric column with a non-default mode,
  an array column with non-null elements, columns whose TypeScript keys
  differ from their SQL names, tables and functions exported under
  names that differ from their SQL names, and roles named in grants and
  policies is exported and read back
- **THEN** every one of those choices is recovered exactly as declared,
  each against the SQL name of the column it belongs to

#### Scenario: A re-added column keeps its own facts
- **WHEN** a table whose physical column order differs from its
  declaration order — one column having been dropped and added again —
  is exported and read back
- **THEN** each column's facts are the ones it was declared with, not
  the ones belonging to whatever column sits at the same position

#### Scenario: A synthesized trigger function carries no export name
- **WHEN** a schema whose only function declarations come from trigger
  definitions is exported
- **THEN** the export carries no export name for them

#### Scenario: A brand is not among the carried facts
- **WHEN** a schema declaring a `$type` brand is exported
- **THEN** the export carries no brand information, and the carried
  facts are unaffected

### Requirement: The export records the formats it is written in
The export SHALL record the version of its own description format and
the version of the embedded snapshot format as separate values, because
they move independently and a reader that cannot tell them apart would
misjudge one when the other changed.

#### Scenario: The two format versions are separate
- **WHEN** the export's format record is read
- **THEN** the description's own format and the embedded snapshot's
  format are available as distinct values

### Requirement: The export includes the SQL that raises the schema
The export SHALL include the squashed SQL that creates the declared
schema from nothing, so that a consumer can stand up a database at the
version it vendored without replaying a migration history it does not
have.

This file SHALL NOT be written where migrations are collected: it is
not a migration, and a tool that reads a directory of `.sql` files must
not be handed a file that would apply the whole schema again.

#### Scenario: The squashed SQL is complete on its own
- **WHEN** the export's SQL is applied to an empty database
- **THEN** the database holds the declared schema

#### Scenario: The squashed SQL is not a migration
- **WHEN** the migrations directory is listed
- **THEN** the export's SQL is not among the files it yields

### Requirement: A committed export matches the declarations beside it
Verification SHALL report an export that does not match the
declarations it sits beside, so that a repository's default branch can
be relied on by consumers who never see its declarations.

This requirement is new. It is not the successor of any earlier
guarantee: it exists because a consumer reads a committed file and has
no other way to know that file was regenerated after the declarations
changed.

#### Scenario: A stale export is reported
- **WHEN** the declarations change and the export is not regenerated,
  and verification runs
- **THEN** it reports the export as not matching, naming the command
  that regenerates it

#### Scenario: A current export passes
- **WHEN** the export was regenerated after the last declaration change
- **THEN** verification reports nothing

## REMOVED Requirements

Each names where it went. None of these is deleted silently.

### Removed: A migration can carry the schema it produced
**Hands off to the apply-engine change.** A row written by a migration
is a record of what was applied; it is not how a consumer learns a
schema, now that a consumer reads a file.

### Removed: The bootstrap is idempotent and precedes the insert
**Hands off to the apply-engine change**, with the statement it guards.

### Removed: The database owns the order of manifest rows
**Hands off to the apply-engine change.** Ordering matters to a ledger
of applications, which is that change's subject.

### Removed: A baseline migration carries no manifest row
**Hands off to the apply-engine change.** How an already-migrated
database is adopted is that change's question.

### Removed: A chain that carries manifests keeps carrying them
**Ends.** It prevented a database's newest row from describing an older
schema while every check reported agreement. Against a committed file
that state cannot arise, so the guarantee has nothing left to prevent.

### Removed: A migration announces its manifest format in the banner
**Ends.** The banner announced a manifest that migrations no longer
carry. Whether an export wants a marker of its own is decided on its
own merits, not inherited.

### Removed: The payload is embedded so that it cannot be misread
**Ends.** The payload was embedded in a SQL literal and needed a guard
against its own terminator. A file has no terminator to escape.
