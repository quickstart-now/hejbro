# Tasks: add-baseline-adoption

One group — the banner marker and the command that sets it are the same
feature, and the CLI tests exercise both. Estimates are pure work minutes
(D88).

## 1. Adopting an existing database

- [x] 1.1 (~6m) [design] The banner marker: `renderBanner` takes an
      optional `baseline` flag, `generateMigration` passes it through.
      The [design] part is placement — directly under the version line,
      above the change list, so it is the first thing anyone opening the
      file reads rather than something they scroll past. Red:
      `packages/core/test/migration-file.test.ts` — "marks a baseline
      directly under the version line". Files:
      `packages/core/src/sql/migration-file.ts`,
      `packages/core/src/engine/generate.ts`, that test.
- [x] 1.2 (~9m) [design] `hejbro baseline` as a mode of `runGenerate`,
      not a second pipeline. The [design] part is that choice: a
      baseline IS a first migration, so if any of how it is built,
      hashed or chained diverged, `verify` would reject the chain it
      starts — the test that proves this is "verify accepts the chain a
      baseline starts". Includes the `baseline-not-first` guard and the
      adoption report. Red: `packages/cli/test/baseline-command.test.ts`.
      Files: `packages/cli/src/commands/generate.ts`,
      `packages/cli/src/main.ts`, that test.
- [x] 1.3 (~6m) `skills/hejbro/references/brownfield-adoption.md`: step 2
      becomes `hejbro baseline`, step 3 states the registration step and
      why the marker exists, and the "tracked as #385" line narrows to
      the half that is still open (introspection-assisted seeding).
      Changeset (D59, `minor`), task times, README badges. Files: that
      reference, `.changeset/*.md`, `openspec/task-times.csv`,
      `README.md`.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` clean.
- The four CLI tests are subprocess tests against the built CLI, so they
  exercise the real command surface, not an in-process shortcut.
