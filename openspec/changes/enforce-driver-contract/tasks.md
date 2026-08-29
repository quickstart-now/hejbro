# Tasks: enforce-driver-contract

Three groups. Estimates are pure work minutes. Groups 1 and 2 share no
file and can run in either order; group 3 lands after both, and owns the
three files neither of them touches. **Verification is not a task**: the
gates below are the definition of done for a group, never a line to tick.

**File ownership.** Group 1 owns `packages/query/**`,
`packages/neon/src/http.ts` and its test, the driver tests of
`packages/pg` and `packages/supabase`, `scripts/check-bans.mjs`,
`skills/hejbro/references/query-layer.md`,
`skills/hejbro/references/neon-preset.md`, and the `driver-contract`
delta. Group 2 owns `packages/core/src/kind/object-kind.ts`,
`packages/supabase/src/storage/bucket-kind.ts` and its test,
`packages/cli/**`, `skills/hejbro/references/dsl-cheatsheet.md`, and the
`cli-commands` delta. Group 3 owns `.changeset/`, `blackbox/`, and
`README.md`. A task that appears to need a file another group owns goes
back to the planner rather than into the diff.

**Gates per group.** The gate set is what CI actually runs plus the
archive gate, not a habit: `pnpm check` (Biome, invoked directly — not a
turbo task, so nothing to force), `TURBO_FORCE=1 pnpm check-types`,
`TURBO_FORCE=1 pnpm test`, `pnpm build --force`, `pnpm check:bans`,
`pnpm check:diagnostic-xref`, `pnpm check:next-marker`, and — for every
group that creates or edits a spec delta (1, 2) —
`openspec validate enforce-driver-contract --strict`. The turbo-run
gates are forced because this repository's cache is shared across
worktrees through the linked worktree's `.git` file: an unforced run can
replay another worktree's logs, and "the gates passed here" stops being
a true sentence. A gate run is quoted with its own summary output;
`Cached: 0 cached, N total` is what makes a turbo gate evidence.

Two CI gates are expected to fail until group 3 lands and are not a
group 1/2 regression: `pnpm changeset status` (no changeset exists yet)
and the README freshness pair (`pnpm check:crap`,
`pnpm check:tasktime`, each followed by CI's own `git diff --exit-code
-- README.md`). Group 3 closes both; before then they are named, not
silently skipped.

**Before 2.1**: the deferred function-valued comparator slot gets its own
issue, filed under the post-0.2.0 umbrella through the issue script, and
its number is what the code-site boundary comment and the spec's
boundary sentence cite. A boundary with no issue number is the gap this
change is closing, in a new place.

**Clock stamps, not recall.** Each task's start and end is a `date -u`
run at that moment, reported as the pair; the planner writes the
difference into `openspec/task-times.csv` when the group completes.

## 1. The driver contract's own surface

Closes #490 and #481. The two are one disease: the query layer holds a
requirement and exports no way to satisfy or observe it, so each preset
re-derives it by hand.

- [ ] 1.1 [design] `~8m` The missing-capability thrower joins the public
      surface. Red: `packages/query/test/exports.test.ts` » "the
      missing-capability thrower is exported" — fails today because
      `packages/query/src/index.ts` exports driver *types* only and no
      value from `driver/errors.ts`. What breaks makes it red: delete
      the new export line from `index.ts` and the assertion fails on the
      missing key. Settles: the exported name (checked against the
      existing diagnostic naming family), that it returns `never` and
      throws rather than returning an `Error`, and that neither
      `assertCapability` nor a returning builder is exported. Files
      either way: `packages/query/src/driver/errors.ts`,
      `packages/query/src/index.ts`,
      `packages/query/test/exports.test.ts`; if the name changes an
      existing symbol, also `packages/query/test/driver/errors.test.ts`.
- [ ] 1.2 `~7m` Neon's HTTP driver constructs the error instead of
      copying it. Red: `packages/neon/test/http-session.test.ts` » "the
      one-shot driver's refusal is the query layer's own error" —
      assert `code`, `capability`, `operation`, and message are what the
      exported thrower produces *when called from the test*, so the
      assertion is pinned to the source of truth rather than to a
      literal. Files: `packages/neon/src/http.ts` (the local
      `throwMissingCapability` and its "kept byte-identical" comment
      both go), `packages/neon/test/http-session.test.ts`.
- [ ] 1.3 `~7m` The copy cannot come back. Red: `pnpm check:bans` (a new
      rule: the missing-capability message template may appear only in
      `packages/query/src/driver/errors.ts`) — red before 1.2 lands,
      because the copy is still in `packages/neon/src/http.ts` today.
      Positive control before believing a clean result: reinstate the
      copied string in a scratch edit and confirm the rule reports it,
      then revert. Files: `scripts/check-bans.mjs`.
- [ ] 1.4 [design] `~10m` The conformance kit's entry shape and exposure.
      Red: `packages/query/test/driver/conformance.test.ts` » "a driver
      that declares session-state false and sends the settings only once
      fails the kit" — fails today because no kit exists to import.
      What breaks makes it red: hand the kit a stub driver whose
      `execute` omits the settings and watch it pass; the kit is wrong
      if it does. Settles: what the caller supplies (a factory building
      the driver over a recording session, versus a live driver),
      whether the kit is a public subpath export of `@hejbro/query`
      (out-of-repo driver authors are consumers too) or repo-internal,
      and the failure text's shape. **Forbidden by construction**: the
      kit checks the obligations of the tier a driver *declares* —
      `false` ⇒ settings ride with each execution, in order; `true` ⇒
      the session-setup hook delivers them — and never infers,
      normalizes, or corrects the declaration from observed behavior,
      which the spec's own scenario ("the declaration stays false")
      forbids. Escalate the exposure choice to the lead before code.
      Files either way: `packages/query/src/testing/driver-conformance.ts`
      (new), `packages/query/test/driver/conformance.test.ts`; if
      exported publicly, also `packages/query/src/index.ts` or
      `packages/query/package.json`'s exports map, and
      `packages/query/test/exports.test.ts`.
- [ ] 1.5 `~8m` The false tier's obligation is observed. Red: same test
      file » "settings ride with the statement, in that order" — a
      recording session captures what a `session-state: false` driver
      sends for one compiled statement; the settings precede the
      caller's SQL and the caller's statement cannot be the first thing
      sent. Files: `packages/query/src/testing/driver-conformance.ts`,
      `packages/query/test/driver/conformance.test.ts`.
- [ ] 1.6 `~8m` The true tier's obligation is observed, and the
      declaration is left alone. Red: same file » "a session-state true
      driver delivers the settings through its setup hook, and still
      reads true" plus "a false driver still reads false after the kit
      has run". Files: same two.
- [ ] 1.7 `~9m` Every in-repo driver runs the kit. Red:
      `packages/pg/test/driver.test.ts`,
      `packages/supabase/test/driver.test.ts`,
      `packages/neon/test/http-session.test.ts` » "conforms to the
      driver contract" in each — three call sites, each supplying its
      own driver; red before the kit exists. Files: those three test
      files.
- [ ] 1.8 `~8m` Spec delta transcribed: the contract is observable, and
      the missing-capability error has one definition presets consume.
      Red: `openspec validate enforce-driver-contract --strict` fails
      while the delta file is absent or malformed; the new scenarios are
      exercised by 1.2/1.5/1.6's tests. A requirement whose title changes
      is written as a RENAMED (`FROM:`/`TO:`) section, never a MODIFIED
      with a new title — the archive refuses that. Files:
      `openspec/changes/enforce-driver-contract/specs/driver-contract/spec.md`.
- [ ] 1.9 `~6m` The skill documents the new surface. Red: none — a
      documentation task; done means the public surface added in 1.1
      (and 1.4, if it is exported) appears in
      `skills/hejbro/references/query-layer.md`, and
      `skills/hejbro/references/neon-preset.md` no longer describes the
      HTTP driver as carrying its own error text. Files: those two.

## 2. `check` routes by registry

Closes #482 and #475. The CLI stops naming a preset's kind, and stops
calling "difference" what it never compared.

- [ ] 2.1 [design] `~9m` The kind's comparison-coverage slot. Red:
      `packages/core/test/kind-registry.test.ts` » "a kind can declare
      that no catalog object backs it, with a reason" — fails today
      because `ObjectKind` has no such member. What breaks makes it red:
      remove the member from the interface and the declaration in the
      test stops type-checking. Settles: the member's name and its data
      shape (optional and additive, like `siblingChanges`,
      `nextSnapshot`, and `requiredKeys` before it), and the wording of
      the reason a kind supplies. A function-valued comparator is out of
      scope by decision; the code site carries a one-line boundary
      naming the issue filed for it. Files either way:
      `packages/core/src/kind/object-kind.ts`,
      `packages/core/test/kind-registry.test.ts`.
- [ ] 2.2 `~8m` The preset declares what the CLI hardcoded. Red:
      `packages/supabase/test/storage-bucket-kind.test.ts` » "the bucket
      kind declares itself uncomparable against a catalog, with the
      reason" (red before 2.1's member exists), and
      `packages/cli/test/check-compare.test.ts` » "the CLI names no
      preset's kind" — a scan of `packages/cli/src/check/compare.ts`
      for `supabase`, red today. Files:
      `packages/supabase/src/storage/bucket-kind.ts`,
      `packages/supabase/test/storage-bucket-kind.test.ts`,
      `packages/cli/test/check-compare.test.ts`.
- [ ] 2.3 `~8m` Comparison routes through the registry. Red:
      `packages/cli/test/check-compare.test.ts` » "a kind that declares
      itself uncomparable is stated in the coverage boundary and does
      not change the exit code" — the comparator gains the registry it
      already has at the call site (`commands/check.ts` builds one) and
      stops keying off a name table for anything a kind can declare.
      Files: `packages/cli/src/check/compare.ts`,
      `packages/cli/src/commands/check.ts`,
      `packages/cli/test/check-compare.test.ts`.
- [ ] 2.4 `~8m` An unregistered kind is not-compared, never differs.
      Red: same test file » "a declared object of an unregistered kind
      is reported as not compared, with the reason, and the run cannot
      exit zero" — today `compareEntry` emits `check-object-differs`
      for it. Files: `packages/cli/src/check/compare.ts`,
      `packages/cli/test/check-compare.test.ts`, and
      `packages/cli/test/check-report.test.ts` if the report's boundary
      line is asserted there.
- [ ] 2.5 `~8m` Spec delta transcribed: the two categories are drawn
      apart — declared-uncomparable (coverage boundary, exit unchanged)
      versus could-not-compare (`check-not-compared`, never exit zero).
      Red: `openspec validate enforce-driver-contract --strict` while
      the delta is absent; the scenarios are exercised by 2.3/2.4.
      RENAMED, not MODIFIED, if a requirement's title moves. Files:
      `openspec/changes/enforce-driver-contract/specs/cli-commands/spec.md`.
- [ ] 2.6 `~7m` The four constraint wrappers become the table they
      already are. Red: `packages/cli/test/check-compare.test.ts` »
      the existing primary-key / unique / foreign-key / check
      assertions, which must stay green across the rewrite — this task
      is a refactor whose red is the absence of behavior change, so it
      lands only with those assertions passing before and after. Files:
      `packages/cli/src/check/compare.ts`.
- [ ] 2.7 `~6m` One foreign-keys section, with a when-to-use-which
      table. Red: none — a documentation task; done means
      `skills/hejbro/references/dsl-cheatsheet.md` has exactly one
      `## Foreign keys` heading, and it states both entry points: the
      column-level `.references()` form (which also feeds relation
      typing) and `extras.foreignKeys` (composite, self-referencing,
      `onDelete`/`onUpdate`), with declaring one column through both
      still refused at declaration time. Files: that one.

## 3. Landing

Runs after groups 1 and 2. Owns files neither of them touches.

- [ ] 3.1 `~6m` One changeset, `minor` — new public surface on the
      published packages (they version as one fixed group, so naming any
      one moves all five). Red: `pnpm changeset status` in CI, which
      fails a published-package change carrying none. Files:
      `.changeset/<generated>.md`.
- [ ] 3.2 `~8m` The flight recorder and the README numbers. Red: none —
      done means `blackbox/` carries this change's entry (what was
      asked, what was decided and built, why, including the two
      rejections this change records: the runtime guard and the
      function-valued comparator slot), and `pnpm check:crap` /
      `pnpm check:tasktime` leave `README.md` unchanged when rerun.
      Files: `blackbox/2026-08-30-enforce-driver-contract.md`,
      `README.md`.
