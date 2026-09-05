# Tasks: harden-adoption

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/engine/diff-engine.ts`,
`packages/core/src/kinds/table-kind*.ts`, `packages/core/src/kinds/
sequence-kind.ts`, `packages/core/src/kind/object-kind.ts` (the change
shape, if a transition flag is needed) and their tests plus goldens
(1.1, 1.2); `packages/cli/src/commands/generate.ts` and its tests (1.3);
`packages/cli/test/*.integration.test.ts` (1.4); `skills/hejbro/
references/brownfield-adoption.md`, `skills/hejbro/references/
extension-interface.md` (the public `KindChange` surface gains an
optional field, 671/R4), one `.changeset/*.md` (1.5). If a
task appears to need any other file, that goes back to the planner, not
into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5.

## 1. Adoption

- [ ] 1.1 (~10m) **[design]** The table's children on adoption. Settles
      how the diff engine tells a kind "this owner was adopted" (a
      transition on the `KindChange`, or a separate create per child
      derived from the table diff). Red: the table-kind diff/emit tests,
      an input table over {index, check, foreign key, primary key} ×
      {adoption → created; handover → nothing; managed unchanged →
      nothing; new table → inside `create table` as today}. Files:
      `diff-engine.ts`, `table-kind*.ts`, tests, goldens.

- [ ] 1.2 (~9m) The adopted sequence. Red: sequence-kind tests — for an
      adopted owner, `create sequence if not exists …;` then `alter
      sequence … as <type>;` and `alter sequence … owned by …;`; for a
      new table, the plain `create sequence` unchanged (a golden pins
      it); a handover then adoption round trip in the engine tests
      yields the idempotent form. Files: `sequence-kind.ts`,
      `diff-engine.ts`, tests, goldens.

- [ ] 1.3 (~7m) **[design]** `adoption-creates`. Settles the message.
      Red: the generate command tests — adoption prints one line per
      adopted table naming each created object kind and the `baseline`
      Next; handover and a new table print nothing; the migration is
      written either way. Files: `generate.ts`, tests.

- [ ] 1.4 (~9m) Live witness on `postgres:17-alpine`: managed →
      handover (sequence kept) → adoption applies cleanly (`42P07` gone),
      the declared index exists afterwards, and `check` reports no
      differences. Files: the integration test.

- [ ] 1.5 (~5m) Docs and changeset. `brownfield-adoption.md` states the
      adoption contract (creates children and normalizes sequences,
      never drops) and the notice, citing the literal
      `warning[adoption-creates]` beside the existing
      `error[baseline-not-first]` (671/R3); `extension-interface.md`
      states the optional `transition` field on `KindChange` (671/R4);
      `pnpm changeset` → `minor`. Files: the two references,
      `.changeset/*.md`.
