## MODIFIED Requirements

### Requirement: Column-level foreign keys are declared with references
A column SHALL be declarable as a foreign key via
`.references(() => <target column>)`, where the thunk names another
declared table's column. The declaration SHALL produce exactly the
foreign key the `extras` path produces — same generated DDL, same
snapshot fields, same diff behavior — so the two declaration forms are
interchangeable for the database. A column-level reference SHALL
additionally carry its target at the TypeScript type level, so the
query layer can derive relations from it without any second
declaration. `.references()` takes no options; self-referencing foreign
keys, composite (multi-column) foreign keys, and `onDelete`/`onUpdate`
actions live on the `extras` path, and a declaration needing them uses
`extras`. Declaring `.references()` and an `extras` foreign key over
the same column SHALL fail at declaration time with an explicit error
naming the column, never a silent double-emit. A table's foreign keys
SHALL emit and snapshot in one canonical, declaration-form-independent
order (sorted by local columns, then target identity) — so mixing the
two forms in one table, or converting a foreign key from one form to
the other, changes neither the generated DDL nor the snapshot.


The thunk SHALL never be resolved while `table()` runs — this is what
lets a reference into another declaration file (or another table in
the same file) resolve whichever one the loader reaches first. The
declaration's first `foreignKeys` read that completes SHALL be cached,
so every `.references()` thunk on that declaration runs at most once
across every later read; a read that throws SHALL cache nothing, so
the next read folds again.

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

#### Scenario: Declaration files, or two tables in one file, that reference each other
- **WHEN** schema file A declares a column with `.references()` into a
  table of schema file B, and B declares one into a table of A — or two
  tables in the same file reference each other the same way
- **THEN** the declarations load and generate under either file order (or,
  for the same-file case, regardless of which table is declared first),
  and the emitted foreign keys are the ones each declaration named

#### Scenario: The thunk resolves once per successful read, not once per read
- **WHEN** a declaration's foreign keys are read more than once and every
  read completes without throwing
- **THEN** each `.references()` thunk runs exactly once, cached after the
  first successful read

#### Scenario: A read whose thunk throws caches nothing
- **WHEN** a declaration's first `foreignKeys` read throws, and it is
  read again
- **THEN** the second read re-runs every `.references()` thunk on that
  declaration, since the failed read cached nothing

#### Scenario: table() itself never resolves a reference thunk
- **WHEN** `table()` returns
- **THEN** no `.references()` thunk on that table has run yet
