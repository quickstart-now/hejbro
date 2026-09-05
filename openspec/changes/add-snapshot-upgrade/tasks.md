# Tasks: add-snapshot-upgrade

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/snapshot/snapshot.ts`,
`packages/core/src/index.ts`, `packages/core/test/snapshot/*` and the
new fixture directory `packages/core/test/fixtures/format-5/` (1.1,
1.2); `packages/core/src/sql/migration-file.ts`, `packages/cli/src/
core-surface.ts`, the barrel export pins (1.3); `packages/cli/src/
commands/upgrade.ts` (new), `packages/cli/src/main.ts`, `packages/cli/
test/upgrade-command.test.ts` (1.4); `packages/cli/src/history-state.ts`,
`packages/cli/src/commands/restore.ts` and their tests (1.5);
`packages/cli/test/upgrade.e2e.test.ts` (1.6, subprocess, dist-fresh
guard); `skills/hejbro/references/generate-verify-workflow.md`,
`docs/specs/2026-08-19-hejbro-design.md` (D101 row), one
`.changeset/*.md` (1.7). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 first (its measurement decides the oracle every later
task relies on); 1.2 and 1.3 are independent after 1.1; 1.4 needs 1.1
and 1.3; 1.5 needs 1.3; 1.6 needs 1.4 and 1.5; 1.7 last.

## 1. Snapshot upgrade

- [ ] 1.1 (~10m) **[design]** Core re-encodes a released older format.
      Settles the export's name and shape (`upgradeSnapshot(raw,
      requiredKeysByKind?) → { text, fromVersion }`, rendering through
      `renderSnapshot(canonicalizeSnapshot(…))`), the floor (5), and the
      oracle. Red: `packages/core/test/snapshot/upgrade.test.ts`, one
      `it.each` over the fixture table — the 0.1.1 release's twelve
      format-5 snapshots, vendored verbatim from the tag
      (`git show hejbro@0.1.1:<path>`) into
      `packages/core/test/fixtures/format-5/<name>.json` — asserting per
      row: result parses at format 8, every object key and kind
      survives, `upgrade(upgrade(x)) === upgrade(x)`; a second table over
      the golden cases whose `declarations.ts` is byte-identical to the
      tag's (measured in this task: `git diff hejbro@0.1.1 HEAD --
      packages/core/test/golden/cases/<case>/declarations.ts`)
      asserting `upgrade(v5 expected) === current expected` byte for
      byte — if no case qualifies, that fact is recorded in the test as
      a skipped table with the diff evidence, not deleted; identity on
      today's two example snapshots; refusals for format 4, the
      pre-`formatVersion` key and format 9 carrying the ordinary read's
      code and message. Green: the version gate gains a "released older
      format" branch used only by this entry; the ordinary
      `parseSnapshot` is unchanged. A required field no rule derives is
      a tripwire — stop and report, do not guess. Files: `packages/core/
      src/snapshot/snapshot.ts`, `packages/core/src/index.ts`,
      `packages/core/test/snapshot/upgrade.test.ts`, the fixtures.

- [ ] 1.2 (~6m) The older-format message splits on the floor. Red:
      `packages/core/test/snapshot/parse.test.ts` (or the existing
      version-message case's file), a table over formats {4, pre-key,
      5, 6, 7} × expected tail: below the floor → the pin-or-reset
      guidance unchanged; 5–7 → ends with `Next: run \`hejbro upgrade\``
      and does not mention pinning or resetting. Files: `packages/core/
      src/snapshot/snapshot.ts`, its test.

- [ ] 1.3 (~7m) **[design]** The `-- upgraded-from:` banner line and
      its parser. Settles the prefix text (`-- upgraded-from: `) and
      the render position (directly under `-- snapshot:`). Red:
      `packages/core/test/sql/migration-file.test.ts`, a table: a banner
      rendered with an `upgradedFrom` hash carries the line under the
      snapshot line; without it, no line; `parseBannerUpgradedFrom`
      returns the hash / `null`; `parseBannerHashes` on an upgraded
      banner still returns the current pair; an unknown line beside it
      changes nothing. Plus the export pin (`packages/core/test/
      exports.test.ts`, `packages/cli/src/core-surface.ts` if the CLI
      re-exports it). Files: `packages/core/src/sql/migration-file.ts`,
      `packages/core/src/index.ts`, `packages/cli/src/core-surface.ts`,
      tests.

- [ ] 1.4 (~10m) **[design]** `hejbro upgrade`. Settles the output
      lines and which existing code each refusal reuses. Red:
      `packages/cli/test/upgrade-command.test.ts` (in-process, like
      `verify`'s own tests), a table of project states: {format-5
      snapshot + intact chain → snapshot rewritten at 8, tip's
      `snapshot:` = sha256 of the new bytes, `upgraded-from:` = the old
      value, every other tip line byte-identical, other migrations
      untouched, output names both files, exit 0}; {format 8 → no write,
      "already at format 8", exit 0}; {format 5, no migrations → snapshot
      only}; {tip hash ≠ stored → `chain-tip-mismatch`, no write};
      {format 9 → newer diagnostic, no write}; {format 4 → pin-or-reset,
      no write}; {migrations, no snapshot → `snapshot-lost`}. Green:
      `commands/upgrade.ts` over `upgradeSnapshot` + `renderBanner`'s
      hash lines (rewrite only the two lines, never re-render the
      banner), registered in `main.ts`. Files: `packages/cli/src/
      commands/upgrade.ts`, `packages/cli/src/main.ts`, the test.

- [ ] 1.5 (~7m) `history` and `restore` resolve an upgraded tip. Red:
      `packages/cli/test/history-state.test.ts` — a migration whose
      added commit's snapshot blob hashes to the `upgraded-from` value
      resolves `ok` (and one whose blob matches neither stays `lost`);
      `packages/cli/test/restore*.test.ts` — restore of an upgraded tip
      rebuilds under the current format and matches the current hash
      (measured, per design Q4; if it does not hold, the task reports
      why before changing restore). Files: `packages/cli/src/
      history-state.ts`, `packages/cli/src/commands/restore.ts`, tests.

- [ ] 1.6 (~9m) End to end over a real 0.1.1 project. Red:
      `packages/cli/test/upgrade.e2e.test.ts` (subprocess over
      `dist/cli.js`, `assertBuiltCli`): a temp git repository seeded
      with the 0.1.1 tag's `examples/postgres` (declarations, migrations,
      format-5 snapshot — vendored under `packages/cli/test/fixtures/
      project-0.1.1/`), committed; `hejbro verify` fails naming
      `upgrade`; `hejbro upgrade` → `verify` passes; `history` reports
      every migration `ok` after the upgrade is committed; a declaration
      edit → `generate` chains onto the new hash and `verify` passes. If
      the tag's declarations do not load under today's `hejbro`, the
      task records which DSL surface moved and narrows to
      upgrade → verify → history, reporting the narrowing to the
      planner. Files: the test and the fixture.

- [ ] 1.7 (~7m) Docs, decision log, changeset. `skills/hejbro/
      references/generate-verify-workflow.md` gains the upgrade section
      (when the refusal appears, what the command rewrites, commit both
      files, the `upgraded-from` line's meaning); D101's row and index
      status record the shipped path; `pnpm changeset` → `minor`. Files:
      the reference, `docs/specs/2026-08-19-hejbro-design.md`,
      `.changeset/*.md`.
