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
sequences — using the same read-only queries `check` runs, and a schema
description whose declaration-time facts are guessed by stated rules
and marked as guessed: a column's TypeScript key from its SQL name by
the stated casing rule with collisions resolved by the stated suffix
rule, the default numeric mode, unknown element nullability read as
nullable, and role names from the grants and policies present. The
reading SHALL infer no function, trigger, policy expression, view body,
or grant beyond its role name, and SHALL say so.

#### Scenario: Tables and enums are inferred
- **WHEN** a database holding two schemas with tables, foreign keys
  between them, a check, an index and an enum type is read
- **THEN** the snapshot records each of them with its columns, keys and
  constraints, and the enum with its values, and the description marks
  every TypeScript key as guessed

#### Scenario: What is not inferred is named
- **WHEN** the database also holds a function, a trigger and a view
- **THEN** none appears in the snapshot, and the loss report names each
  kind as not inferred

### Requirement: The loss is announced, with the way out
Every command that uses a catalog reading SHALL print a loss report
naming what was guessed (keys, modes, element nullability), what was
not inferred, and the command that removes the loss — linking the
schema repository for `pull`, hand-editing the starter declarations
for `import`.

#### Scenario: The report names the way out
- **WHEN** `pull --db-url` completes
- **THEN** its output names the guessed facts and says the loss ends
  when the consumer links the schema repository
