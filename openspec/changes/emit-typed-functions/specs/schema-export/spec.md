# Delta: schema-export

## MODIFIED Requirements

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
