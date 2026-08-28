# table-declaration (delta)

## ADDED Requirements

### Requirement: Column-level foreign keys are declared with references
A column SHALL be declarable as a foreign key via
`.references(() => <target column>)`, where the thunk names another
declared table's column. The declaration SHALL produce exactly the
foreign key the `extras` path produces — same generated DDL, same
snapshot fields, same diff behavior — so the two declaration forms are
interchangeable for the database. A column-level reference SHALL
additionally carry its target at the TypeScript type level, so the
query layer can derive relations from it without any second
declaration. Self-referencing foreign keys, composite (multi-column)
foreign keys, and `onDelete`/`onUpdate` actions SHALL remain on the
`extras` path — `.references()` takes no options in v1, and a
declaration needing them uses `extras`. Declaring `.references()` and
an `extras` foreign key over the same column SHALL fail at declaration
time with an explicit error naming the column, never a silent
double-emit. A table's foreign keys SHALL emit and snapshot in one
canonical, declaration-form-independent order (sorted by local
columns, then target identity) — so mixing the two forms in one
table, or converting a foreign key from one form to the other,
changes neither the generated DDL nor the snapshot.

#### Scenario: A column-level reference emits the same DDL as extras
- **WHEN** a table declares `ownerId: uuid().notNull().references(()
  => users.id)` and an otherwise-identical table declares the same
  edge through `extras.foreignKeys`
- **THEN** both generate identical `create table` foreign-key clauses
  and identical snapshot content

#### Scenario: The reference survives to the type level
- **WHEN** a column declares `.references(() => users.id)`
- **THEN** the resulting table type records the edge (target table and
  column), and the query layer's relation derivation can read it

#### Scenario: A mixed-form table emits in canonical order
- **WHEN** one table declares one foreign key through `.references()`
  and another through `extras`, and an otherwise-identical table
  declares both through `extras`
- **THEN** both generate identical DDL and identical snapshot content

#### Scenario: Duplicate declaration over one column fails loudly
- **WHEN** a column declares `.references(...)` and the same column is
  also named in an `extras` foreign key
- **THEN** `table()` fails at declaration time with an explicit error
  naming the column
