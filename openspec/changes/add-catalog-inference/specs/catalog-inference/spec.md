# Delta: catalog-inference

## Purpose

Defines what hejbro infers when it reads a live database catalog
instead of declarations, which facts it guesses, which it does not
infer at all, and how it announces the loss — the one reading shared by
`import` and `pull --db-url`.

## ADDED Requirements

### Requirement: A catalog reading yields a snapshot and a marked description
Reading a database through the catalog SHALL yield a snapshot of the
schemas named — tables with columns, defaults, identity and generated
markers, primary keys, foreign keys, checks and indexes; enum types;
and the sequences an identity or serial column owns, carried as that
column rather than as sequences of their own — through read-only
catalog queries: `check`'s own inventory
queries plus the column-, constraint-, index- and enum-detail queries
inference needs on top of them, all read-only, none writing to the
database. It SHALL also yield a schema description whose
declaration-time facts are guessed by the rules stated here and marked
as guessed: a column's TypeScript key from its SQL name by lower-casing
it and joining the runs between non-alphanumeric characters in camel
case, keeping leading underscores and prefixing `_` to a key that would
otherwise start with a digit, with collisions resolved by leaving the
key to the earliest column in physical order and appending to each
later colliding key the smallest integer from 2 upwards that leaves it
free; the default numeric mode; unknown element nullability read as
nullable; and role names from the grants and policies present. The
description SHALL be built from the catalog reading directly, so every
column the reading found is carried with a guessed key; a declaration
round trip is not its source, and a column that no declaration can
express is therefore still described — described, but never contracted:
a contract carries the columns the snapshot holds, and a column the DSL
cannot name never reaches the snapshot. The reading SHALL infer no
function, trigger, policy expression, view body, grant beyond its role
name, column whose type no column builder expresses, or standalone
sequence that no column owns — the DSL has no `defineSequence()` (D66)
— and SHALL say so.

#### Scenario: Tables and enums are inferred
- **WHEN** a database holding two schemas with tables, foreign keys
  between them, a check, an index and an enum type is read
- **THEN** the snapshot records each of them with its columns, keys and
  constraints, and the enum with its values, and the description marks
  every TypeScript key as guessed

#### Scenario: Two SQL names that collide on one key are both described
- **WHEN** a table holds `user_id` and a quoted `USER_ID`, whose
  TypeScript keys collide
- **THEN** the description carries both columns, the first in physical
  order under the plain key and the second under the key with the
  collision suffix, and the loss report names the column that cannot be
  declared, since only one of the two can be named by a declaration

#### Scenario: What is not inferred is named
- **WHEN** the database also holds a function, a trigger, a view, a
  column whose type no column builder expresses, and a sequence no
  column owns
- **THEN** none appears in the snapshot, the loss report names each kind
  as not inferred, and it names that column with its type and that
  sequence by name

### Requirement: The loss is announced, with the way out
Every command that uses a catalog reading SHALL print a loss report
naming what was guessed (keys, modes, element nullability), what was
not inferred, every approximation the reading made — a UNIQUE
constraint is inferred as a unique index carrying the constraint's own
name, so re-creating it emits `create unique index` rather than
`add constraint … unique`; a `nextval` default on a sequence the column
does not own is kept as a raw default, naming that sequence;
expressions are carried as raw SQL text rather than as the typed
builders a hand-written declaration would use — and the command that
removes the loss:
linking the schema repository for `pull`, hand-editing the starter
declarations for `import`.

#### Scenario: The report names the way out
- **WHEN** `pull --db-url` completes
- **THEN** its output names the guessed facts and says the loss ends
  when the consumer links the schema repository
