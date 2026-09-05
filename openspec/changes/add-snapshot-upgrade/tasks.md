# Tasks: add-snapshot-upgrade

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/snapshot/snapshot.ts`,
`packages/core/src/index.ts`, `packages/core/test/snapshot/*` and the
new fixture directory `packages/core/test/fixtures/format-5/` plus the
`biome.json` override that keeps those vendored bytes unformatted, the
same way the golden `expected/` trees are exempt (1.1, 1.1b, 1.2); `packages/core/src/sql/migration-file.ts`, `packages/cli/src/
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
task relies on), then 1.1b, which the golden byte oracle waits on; 1.2
and 1.3 are independent after 1.1b; 1.4 needs 1.1b and 1.3; 1.5 needs
1.3; 1.1c comes from what 1.6 found and 1.6 waits on it; 1.7 last.

## 1. Snapshot upgrade

- [x] 1.1 (~10m) **[design]** Core re-encodes a released older format.
      Settles the export's name and shape (`upgradeSnapshot(raw,
      registry, requiredKeysByKind?) → { text, fromVersion }` — the
      registry is required because the canonical form is per-kind and a
      format change may be a kind's own canonicalization, rendering
      through `renderSnapshot(canonicalizeSnapshot(…))`), the floor (5),
      and the
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
      `packages/core/test/snapshot/upgrade.test.ts`, the fixtures, and
      `packages/cli/src/core-surface.ts` — the barrel curation gate
      (`packages/cli/test/exports.test.ts`) classifies every core runtime
      export, so a new export fails that gate until its name joins
      `ENGINE`.

- [x] 1.1b (~10m) **[design]** The re-encoding reads every stored node
      under the current codec. Settles where the step runs (inside
      `upgradeSnapshot` only, before `canonicalizeSnapshot`) and how a
      node is recognised: by its own discriminator — `nodeKind` for an
      expression, `queryKind` for a query — never by a per-kind field
      list, so a preset's own node is covered without a core special
      case. The step is what makes a field the older shape lacks decode
      to its empty value; canonicalization only orders set-shaped
      arrays, and the two are separate claims. Red:
      `packages/core/test/snapshot/upgrade.test.ts`, two tables — the ten
      golden cases asserting byte equality with the current expected (the
      rows 1.1 leaves red), and a fixed-point table over snapshots built
      in memory by `buildSnapshot`: a view whose body is a `with` query
      and one whose body is each of `union`/`except`/`intersect`, neither
      shape present in any committed snapshot, asserting the re-encoding
      returns its input byte for byte. Green: one recursive pass that
      round-trips the outermost discriminator-bearing subtree through its
      codec and leaves every other value untouched; the `with` dispatch
      calls the codec's own `with` pair directly, which `encodeQueryNode`
      deliberately excludes, so the generic pass depends on no kind
      module. Files: `packages/core/src/snapshot/snapshot.ts`, its test.

- [x] 1.2 (~6m) The older-format message splits on the floor. Red:
      `packages/core/test/snapshot.test.ts`, the existing
      version-message case's file, a table over formats {4, pre-key,
      5, 6, 7} × expected tail: below the floor → the pin-or-reset
      guidance unchanged; 5–7 → ends with `Next: run \`hejbro upgrade\``
      and does not mention pinning or resetting. Files: `packages/core/
      src/snapshot/snapshot.ts`, its test.

- [x] 1.3 (~7m) **[design]** The `-- upgraded-from:` banner line and
      its parser. Settles the prefix text (`-- upgraded-from: `) and
      the render position (directly under `-- snapshot:`). Red:
      `packages/core/test/migration-file.test.ts`, a table: a banner
      rendered with an `upgradedFrom` hash carries the line under the
      snapshot line; without it, no line; `parseBannerUpgradedFrom`
      returns the hash / `null`; `parseBannerHashes` on an upgraded
      banner still returns the current pair; an unknown line beside it
      changes nothing; a banner rendered from a file that already
      carries the line keeps one line holding the first hash, and the
      parser returns that value. Plus the export pin
      (`packages/cli/test/exports.test.ts`): the parser joins its three
      siblings in `VOCABULARY`, that list being exactly what the skill
      documents as a `hejbro` import, and this line's stated consumer is
      a tool outside hejbro. Files: `packages/core/src/sql/
      migration-file.ts`, `packages/core/src/index.ts`,
      `packages/cli/src/core-surface.ts`, `packages/cli/src/index.ts`,
      tests.

- [x] 1.4 (~10m) **[design]** `hejbro upgrade`. Settles the output
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
      no write}; {migrations, no snapshot → `snapshot-lost`}; {a tip already
      carrying `upgraded-from` upgraded again → still one line, still the
      hash the tip first recorded}. Green:
      `commands/upgrade.ts` over `upgradeSnapshot` plus a core rewrite of
      the two banner lines (never a re-render — the CLI does not hold the
      change list a banner is built from). The line surgery, and with it
      the one-line/first-hash rule, stays in `migration-file.ts`: the
      banner's prefixes are core's own and are not duplicated across the
      package boundary. Registered in `main.ts`. Files: `packages/core/
      src/sql/migration-file.ts` and `packages/core/test/
      migration-file.test.ts` (the rewrite and its own table),
      `packages/core/src/index.ts`, `packages/cli/src/core-surface.ts`,
      `packages/cli/src/commands/upgrade.ts`, `packages/cli/src/main.ts`,
      `packages/cli/src/config-required.ts` (the command's own entry),
      `packages/cli/src/commands/verify.ts` (exporting the
      `chain-tip-mismatch` error itself, code and message together, so
      the marker check reads one site rather than two files), the test.

- [x] 1.5 (~7m) `history` and `restore` resolve an upgraded tip. Red:
      `packages/cli/test/history-state.test.ts` — a migration whose
      added commit's snapshot blob hashes to the `upgraded-from` value
      resolves `ok` (and one whose blob matches neither stays `lost`);
      `packages/cli/test/restore*.test.ts` — restore of an upgraded tip
      rebuilds under the current format and matches the current hash
      (measured, per design Q4; if it does not hold, the task reports
      why before changing restore). Files: `packages/cli/src/
      history-state.ts`, `packages/cli/src/commands/history.ts` and
      `packages/cli/src/commands/restore.ts` (both call the state
      resolver), tests.

- [x] 1.1c (~8m) A table's foreign keys reach the canonical order from
      whatever order was recorded. The serializer writes them canonically,
      so the canonical form treated them as already sorted and let a
      released older snapshot keep its own order — the re-encoding then
      rendered a snapshot the fresh build does not reproduce, and
      `verify` reports the upgraded project stale. Red:
      `packages/core/test/kinds/table-kind.test.ts` and
      `packages/core/test/snapshot/upgrade.test.ts`, four tables: a table
      node whose `foreignKeys` are recorded in each order two edges admit,
      asserting one canonical result; the twelve format-5 fixtures
      asserting **every** table in the re-encoded result carries its
      foreign keys in canonical order — structural, not byte, because a
      byte oracle is silent on a fixture that is canonical already, which
      is exactly why nothing caught this; the sixteen current-format
      snapshots asserting the added ordering leaves them byte-identical;
      the golden byte oracle unchanged. Green: `canonicalizeTable` orders
      `foreignKeys` by the key the serializer already uses. Files:
      `packages/core/src/kinds/table-kind.ts`, the two tests.

- [x] 1.6 (~9m) End to end over a real 0.1.1 project. Red:
      `packages/cli/test/upgrade.e2e.test.ts` (subprocess over
      `dist/cli.js`, `assertBuiltCli`): a temp git repository seeded
      with the 0.1.1 tag's `examples/postgres` (declarations, migrations,
      format-5 snapshot — vendored under `packages/cli/test/fixtures/
      project-0.1.1/`), committed in the batches the tag itself committed
      them in, so the fixture's history is the released project's rather
      than a tidier one; `hejbro verify` fails naming `upgrade`;
      `hejbro upgrade` → `verify` passes; once the upgrade is committed,
      `history` reports the tip `ok` at the commit that originally added
      it, and every other migration holds the state it held before the
      upgrade — one batch-committed with a later migration reads `lost`
      on both sides, the tool's standing behaviour and not this change's
      to alter; `restore` of the tip succeeds; a declaration
      edit → `generate` chains onto the new hash and `verify` passes. If
      the tag's declarations do not load under today's `hejbro`, the
      task records which DSL surface moved and narrows to
      upgrade → verify → history, reporting the narrowing to the
      planner. Files: the test and the fixture.

- [x] 1.7 (~7m) Docs, decision log, changeset. `skills/hejbro/
      references/generate-verify-workflow.md` gains the upgrade section
      (when the refusal appears, what the command rewrites, commit both
      files, the `upgraded-from` line's meaning); D101's row and index
      status record the shipped path; `pnpm changeset` → `minor`. Files:
      the reference, `docs/specs/2026-08-19-hejbro-design.md`,
      `.changeset/*.md`.
