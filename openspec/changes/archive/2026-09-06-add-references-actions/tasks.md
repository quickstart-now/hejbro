# Tasks: add-references-actions

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/types/column-builder.ts`,
`packages/core/src/dsl/table.ts` and the column-reference tests (1.1,
1.2); `examples/postgres/src/**` declarations only (1.3);
`skills/hejbro/references/dsl-cheatsheet.md`,
`docs/specs/2026-08-19-hejbro-design.md` (D102 row), one `.changeset/*.md`
(1.4). If a task appears to need any other file, that goes back to the
planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4.

## 1. Actions on the column form

- [x] 1.1 (~9m) **[design]** The options argument. Settles the signature
      (`references(target, actions?: { readonly onDelete?:
      ForeignKeyAction; readonly onUpdate?: ForeignKeyAction })`) and the
      column-state slot that carries them to the fold. Red: the
      column-reference test file, an `it.each` over `foreignKeyActions ×
      {onDelete, onUpdate, both, neither}`: the `.references()` table and
      the `extras` table generate identical `create table` DDL and
      identical rendered snapshots. Green: the builder stores the
      actions beside the thunk; `foldColumnReferences` emits them. Files:
      `column-builder.ts`, `table.ts`, tests.

- [x] 1.2 (~6m) Diff parity. Red: a snapshot from `.references()` with
      `onDelete: "cascade"` diffed against the same edge with
      `"restrict"` produces the same drop-and-add migration the `extras`
      pair produces; a rename of the target table retargets the
      column-form edge with its actions intact. Files: tests (and
      `table.ts` only if a gap shows).

- [x] 1.3 (~8m) The example converts. Red: `hejbro verify` in
      `examples/postgres` after converting every single-column foreign
      key to `.references()` with its actions — the snapshot and the
      chain must stay byte-identical (verify's own check 1 and 2), and
      `pnpm --filter example-postgres roundtrip` passes on local Docker.
      Composite or self-referencing keys stay on `extras`. Files:
      `examples/postgres/src/**`. `app.schema.ts` and
      `steps/step-10.schema.ts`'s byte-identity is a convention, not a
      mechanical gate — `test/chain.test.ts` enforces it indirectly by
      requiring `step-10`'s declarations to reproduce the same committed
      migrations and snapshot `app.schema.ts` is verified against.

- [x] 1.4 (~6m) Docs, decision log, changeset. The cheatsheet's
      foreign-key table teaches the actions on the column form; D102's
      row drops "actions stay on the `extras` path" for the shipped
      sentence; `pnpm changeset` → `minor`. Files: the reference, the
      design spec, `.changeset/*.md`.
