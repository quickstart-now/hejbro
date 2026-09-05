# Proposal: add-references-actions (#514)

## Why

The form the cheatsheet teaches first cannot express a foreign key's
referential actions. `.references(() => users.id)` folds into the same
declaration `extras.foreignKeys` builds, with `onDelete`/`onUpdate`
hard-coded to nothing; a column that needs `on delete cascade` has
exactly one option, the `extras` form in full, because declaring both
forms on one column is refused as a double emit. Every one of the seven
foreign keys in `examples/postgres` carries an action, so the first-taught
form covers none of them. Measured: the two forms generate byte-identical
DDL except for the trailing `on delete cascade` the column form drops.

## What Changes

- **`.references()` takes the actions.** A second, optional argument
  `{ onDelete?, onUpdate? }` over the same action vocabulary the `extras`
  form accepts; the fold carries them into the one `ForeignKeyDeclaration`
  both forms build, so DDL, snapshot and diff stay byte-identical between
  the forms — actions included. The type-level edge is unchanged (an
  action changes no type). Self-referencing and composite foreign keys
  stay on `extras`; the duplicate-declaration refusal is unchanged.
- **The example proves parity.** `examples/postgres` converts its
  column-level-shaped foreign keys to `.references()` with their
  actions; the committed snapshot and migrations do not change by a
  byte, and the round trip passes.
- The cheatsheet teaches the actions on the first form; the D102 row's
  sentence that kept actions on `extras` is amended; one `minor`
  changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`table-declaration`** — MODIFIED requirement: *Column-level foreign
  keys are declared with references* (the options argument; a scenario
  over the action vocabulary).

## Impact

- `@hejbro/core`: `types/column-builder.ts` (signature and the
  column-state slot), `dsl/table.ts` (`foldColumnReferences`), tests.
- `examples/postgres`: declaration form only; artifacts byte-identical.
- `skills/hejbro`: `references/dsl-cheatsheet.md`; the design spec's
  D102 row.
