# schema-export Specification

## Purpose
This capability covers what a repository publishes about the schema it
declares: a machine-readable description of the declared objects, the
squashed SQL that raises that schema from nothing, and the record of
the formats both are written in. The export is produced from the
declarations rather than from a database, so it can be written where
no database exists, and it is committed, so anything that can read a
file can read the schema. What the export carries, what it
deliberately does not carry, and the determinism that lets it be
reviewed as a diff are stated here.

## Requirements

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
that name, and for functions, because a typed call is keyed by it —
**a function's arguments and return shape** — per argument, in
declaration order, the TypeScript key it was declared under, its SQL
name, its declared type, its numeric mode and whether its array
elements are constrained non-null; and for the return, whether it is a
scalar, with its declared type and numeric mode, or a table, named by
that table's schema and name — and **the role names the schema declares
in its grants and policies**. An argument carries the same four facts a
column does, plus its key, because for the purpose of typing a call an
argument *is* a column: the caller's value is checked against exactly
the type a column of that declaration would read back as. The keys are
carried because a typed call names its arguments by them and the
snapshot records only the SQL names; the types are carried because the
snapshot renders an argument's type as SQL text, and recovering a
declared type from that text would mean parsing SQL to rebuild
something the declaration already had; and the numeric mode and element
nullability are carried because they are declaration-time choices that
no SQL text holds at all. The return shape is carried because the
consumer's call must know whether to expect a value or rows.

Every fact that belongs to a column SHALL be carried against that
column's SQL name, never against its position. The snapshot records
columns in physical order and a declaration lists them in the order
they were written; those agree until a column is dropped and added
again, and a reader joining them by position would from then on attach
each fact to the wrong column while every type still looked right.

A declaration that was never a module export has no export name to
carry: a function synthesized as part of a trigger definition is in the
snapshot but was never exported, so nothing downstream can offer it as
something the owning repository itself has. Such a function also
carries no return shape, for the same reason and not a second one: it
returns neither a value nor rows but the trigger sentinel Postgres
supplies when it fires the trigger, so there is no shape a call could
be typed against — and there is no call.

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
- **THEN** the export carries no export name for them, and no return
  shape either

#### Scenario: A function's argument keys ride with its SQL names
- **WHEN** a function declared with arguments whose TypeScript keys
  differ from their SQL names is exported and read back
- **THEN** each argument's key is recovered against that argument's SQL
  name, in declaration order, and the return is marked scalar or table
  as declared

#### Scenario: An argument's declared type survives with its choices
- **WHEN** a function declaring an argument with a non-default numeric
  mode, and an array argument whose elements are constrained non-null,
  is exported and read back
- **THEN** each argument's declared type, numeric mode and element
  nullability are recovered as declared, and a scalar return's declared
  type and numeric mode with them — so a consumer types a call exactly
  as the declaring repository does, without reading SQL text

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

### Requirement: The export carries existing tables as such
The schema description SHALL carry each existing table the schema
declares — one built with `existingTable()`, declared for its shape and
never managed — with the same facts it carries for a managed one:
export name, column keys, numeric modes, element nullability. It SHALL
mark the table existing, so a reader can offer it for reading and
joining and never for migration. A description written before that mark
existed SHALL read as carrying only managed tables.

#### Scenario: An existing table survives the round trip
- **WHEN** a schema declaring an existing table is exported and read
  back
- **THEN** the table is recovered with its declared columns and their
  facts, marked existing

#### Scenario: A description written before the mark reads as managed
- **WHEN** a description written before the existing mark was added is
  read
- **THEN** it is accepted, and every table in it reads as managed
