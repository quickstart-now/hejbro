# Tasks: fix-lifecycle-review

Five groups. Groups 1–4 share no files and are parallel-safe; group 5 is
cache inputs, docs and release chore that quote names groups 1–4 settle,
so it runs last. Estimates are pure work minutes (D88). Every task starts
from a failing test named below.

Every `[design]` decision below is already settled — the value is
recorded in the task. None is open, so no task waits on a decision.

## 1. Nested-transaction lifecycle

Files (whole group): `packages/query/src/db/transaction.ts`,
`packages/query/test/db/transaction.test.ts`,
`packages/pg/test/integration.test.ts`.

- [x] 1.1 (~10m) [design — settled] D1: a second in-flight nested
      transaction on the same `tx` is rejected with
      `concurrent-nested-transaction`, before any savepoint SQL is sent,
      and its callback never runs. Message carries a `Next:` clause
      naming sequential nesting (await one before starting the next).
      Guard state is per built `transaction` member, mirroring
      `createTransactionApi`'s own `state.active`. Documentation-only was
      considered and rejected by the lead: silent data loss is not
      acceptable in this repo. Red:
      `packages/query/test/db/transaction.test.ts` — "concurrent sibling
      nested transactions are rejected, and the first sibling's work
      survives". Assert the surviving rows, not only the error: an
      error-only assertion also passes against today's `no such
      savepoint` ordering, so it would not be load-bearing.
- [x] 1.2 (~7m) A callback that throws synchronously rolls back:
      `callback().catch(...)` is replaced by `try`/`await`/`catch`, which
      also covers a throw that happens before the promise exists. Red:
      same file — "a nested callback that throws synchronously rolls back
      to its savepoint and rethrows unchanged".
- [x] 1.3 (~9m) [design — settled] R2: a failing `RELEASE` attempts
      `ROLLBACK TO` for that savepoint; on a successful rollback it
      surfaces `savepoint-release-failed` — named for its mechanism, like
      its sibling `savepoint-rollback-failed` — carrying the release
      failure as `cause`, with a `Next:` advising rethrowing inside the
      nested callback instead of swallowing (a swallowed statement error
      is what aborted the subtransaction). After a successful recovery
      rollback the savepoint is released too, best-effort: `ROLLBACK TO`
      clears the aborted state, so the release now succeeds, and the
      invariant below stays uniform. A release that fails again is not
      surfaced separately — the error thrown is still
      `savepoint-release-failed` carrying the *first* failure as `cause`,
      so the error identity does not depend on how the recovery went. If
      the recovery rollback itself fails, the existing
      `savepoint-rollback-failed` path takes over. Red: same file — "a
      swallowed statement error inside a nested
      callback issues a ROLLBACK TO and surfaces
      `savepoint-release-failed`", asserted on the recording driver's
      statement log, not only on the error.
- [x] 1.4 (~6m) A rolled-back savepoint is also released, so a
      transaction that nests repeatedly does not grow its savepoint stack
      for its own lifetime (the prevailing ORM convention). Ordering with
      1.3 matters: this is the throw path's release, 1.3's is the
      release path's rollback. Red: same file — "a rolled-back savepoint
      is released, leaving no savepoint behind" (statement-sequence
      assertion).

      **The invariant both tasks serve**: no savepoint outlives the
      nested transaction that created it, on every exit — normal return,
      thrown callback, and failed release alike. An enclosing callback
      may catch any of these and keep going, so "we are about to throw
      anyway" is not a reason to leave one behind. Any exit that cannot
      hold the invariant fails loudly instead (1.3's fallback), never
      silently.
- [x] 1.5 (~6m) [design — settled] R1: `savepoint-rollback-failed`'s
      message stops asserting "the enclosing transaction will roll back".
      Text to use, verbatim unless every one of the three required
      elements survives a rewording — (a) both outcomes stated, (b) the
      imperative not to catch, (c) the `cause`/`callbackError` pointers:

      > rolling back to savepoint "<name>" failed after the nested
      > transaction callback threw. Do not catch this error: if it
      > escapes the enclosing callback the transaction rolls back, and if
      > you catch it the transaction can still commit without the nested
      > work. Next: inspect "cause" for the rollback failure and
      > "callbackError" for what the callback threw — when the rollback
      > failed because the connection itself is unusable, letting this
      > error escape is also what gets that connection discarded.

      "the connection is likely no longer usable" moves inside that
      conditional: it is true only on the escape path the driver
      discards. Same task removes the orphaned and now-contradictory tsdoc
      in this file (`buildTx`'s stray second block; `Tx`'s "there is no
      `.transaction` member here at all … `tx.transaction(...)` is a
      `tsc` error", directly above the member that exists). Red: same
      file — the message assertion in the existing rollback-failure test.
- [x] 1.6 (~7m) Live witness against a real postgres:17 — the server's
      own behavior, not a fixture driver's. Red:
      `packages/pg/test/integration.test.ts` — "concurrent nested
      transactions are refused before any savepoint is sent" and "a
      swallowed statement error is recovered by ROLLBACK TO and leaves
      the enclosing transaction usable".

- [x] 1.7 (~10m) Review rework (3780fea, blockers B1–B3):
      **B1** `let result: T;` is the only `let` in the repository's own
      source — AGENTS.md forbids it and Biome has no `noLet`, so
      `pnpm check` cannot catch it. Normalize the callback into a
      rejection with an async wrapper, which drops both the `let` and the
      doubled `try` without losing 1.2's synchronous-throw coverage.
      **B2** the fallback path's message asserts something false — the
      reused `rollbackOrFail` says "after the nested transaction callback
      threw" and files the release failure under `callbackError`, on a
      path where the callback *returned normally*. That is R1's own
      defect class, reintroduced by R1's own commit. Parameterize the
      helper with the triggering fact and the side-property name so each
      path states what is true; the delta's "carrying both failures" is
      unaffected, and 1.5's three elements stay on the callback-throw
      path.
      **B3** the delta scenario "A failing recovery rollback falls
      through" has no test — a spec scenario without one is not a
      contract. Red: `packages/query/test/db/transaction.test.ts` — a
      release failure *and* a failing recovery rollback, asserting the
      `savepoint-rollback-failed` identity and that both messages state
      only true facts. This single test closes B2 and B3 together; had it
      existed, B2 would have surfaced while writing it.
      **B4** the throw path's own release (added by 1.4) is unguarded, so
      a release failure there escapes as a bare `query-execution-failed`
      and the callback's error is **lost**. That breaks the MODIFIED
      requirement's "rethrowing that error unchanged" and lands in
      exactly the shape R2 says never to produce. Same root as B2: the
      two operations added here were reasoned through on one path only.
      Symmetry is the fix — the throw path's release becomes best-effort
      too (`.catch`), and the callback's error is rethrown unchanged.
      Red: same file — "a release failure after a successful rollback
      still rethrows the callback's own error" (`expect(outcome).toBe(
      boom)`, identity not shape).
      Optional (reviewer's recommendations, not blockers): move
      `expect(secondRan).not.toHaveBeenCalled()` ahead of the outcome
      assertion in 1.1 so "the callback never ran" is what fails first;
      and pin `cause` by identity in the B3 test (its message names
      `release savepoint "hejbro_sp_1"`), since today's two tests assert
      only that a `cause` exists — "the *first* release failure" is
      specified but unverified.

      Closing note from the review (mutation-verified: nulling `cause`
      reds both): the two `savepoint-release-failed` tests are load-
      bearing **only as a pair**. The all-releases-fail fixture cannot
      tell first from last (same message text); the recover-then-succeed
      fixture is what catches a drift to "whatever the last release
      attempt saw". Whoever later finds them redundant will be wrong —
      that constraint belongs in a comment beside them, not only here.

## 2. `baseline` command surface

Files (whole group): `packages/cli/src/commands/generate.ts`,
`packages/cli/test/baseline-command.test.ts`,
`packages/cli/test/help.test.ts`.

- [x] 2.1 (~8m) [design — settled] D2: in `"baseline"` mode a no-change
      run fails with `baseline-nothing-to-adopt` and exit 1 instead of
      printing `no changes — snapshot already matches your declarations`
      and exiting 0. The message diagnoses the actual state — the
      declarations loaded but exported no hejbro declarations, or they
      are empty — plus a `Next:` clause pointing at the config's
      declaration entry points. "Already matches" is doubly wrong here:
      the guard directly above has just established the snapshot is
      empty. `generate` mode's own no-change line and exit 0 are
      untouched (three example suites plus `generate-command.test.ts`
      assert that text). Red:
      `packages/cli/test/baseline-command.test.ts` — "a baseline over
      declarations that export nothing fails with
      `baseline-nothing-to-adopt` and writes no files".
- [x] 2.2 (~9m) [design — settled] `baseline` stops advertising
      `--rename`/`--confirm-drop` — nothing exists to rename or drop in a
      first migration — and rejecting them is a pre-parse intercept in
      `runGenerate`'s `"baseline"` mode, not a citty unknown-flag dump:
      the flags are caught before argument parsing and refused with
      `baseline-flag-not-applicable`, whose message gives the reason
      (a baseline diffs against an empty snapshot, so there is nothing to
      rename and nothing to drop) and a `Next:` naming `hejbro generate`
      for a change to an already-adopted project. Red:
      `packages/cli/test/help.test.ts` — "`baseline --help` does not list
      the rename or drop-confirmation flags"; and
      `packages/cli/test/baseline-command.test.ts` — "`baseline
      --rename …` fails with `baseline-flag-not-applicable` before
      anything is written".

- [x] 2.3 (~9m) Review rework (774948f, blocker B5 + recommendations):
      **B5** `baseline-flag-not-applicable` renders as
      `error[baseline-flag-not-applicable]: hejbro generate` — the header's
      second slot is the diagnostic's *identity*, the file the error is
      about, and `identityFromMessage` takes the message's first quoted
      token. The new message quotes the remedy command, so the remedy
      lands where the filename belongs. This is CLI error text, which
      AGENTS.md counts as an observable contract, and golden text
      hardens once archived. Fix: quote the command in backticks, the
      repo's own convention (`loader.ts`'s ``run `hejbro init` ``), so
      the header falls back to the config identity.
      `baseline-nothing-to-adopt` renders its entry glob and is correct
      as-is. Red: `packages/cli/test/baseline-command.test.ts` — the
      rendered header names the config, not the remedy.
      **R-a** the delta's "before any declaration is loaded" half has no
      test: moving the intercept after `loadDeclarations` keeps all 15
      tests green. Pin it with a config-less directory —
      `baseline --rename …` there must fail with
      `baseline-flag-not-applicable`, not `config-not-found`.
      **R-b** `BASELINE_ARGS` is a hand-kept *inclusion* list (its
      comment claims subtraction) and `BASELINE_INAPPLICABLE_FLAGS`
      encodes the same set a second time. Derive both from one exclusion
      list, or assert help's flag set as "generate's minus those two".
      **R-c** `--rename=app.old=posts` is refused correctly today but
      untested; one line pins that normalization stays ahead of the
      intercept.
      **R-d** `baselineNothingToAdoptDiagnosis`'s `declarationCount > 0`
      branch has no test and no evident reachable path — the emptiness
      guard above means any real declaration makes `hasChanges` true.
      Show a reachable case or delete the branch.

- [ ] 2.4 (~5m) Two constraints the group 2 review surfaced that live
      only in review prose today — both are one comment each, stating the
      constraint only:
      (a) `help.test.ts`'s flag regex (`--([a-z-]+)=`) matches
      value-taking flags only. Every `GENERATE_ARGS` entry is a string
      today so the comparison is symmetric and sound, but a boolean flag
      added later would silently escape the drift check R-b exists to
      provide. Note it where the regex is.
      (b) `baseline-nothing-to-adopt`'s message now states flatly that
      the declarations exported nothing. That is true only while every
      declaration kind contributes at least one change to an empty
      snapshot (R-d's finding). Note the dependency where the message is
      built, so a future kind that fans out to zero changes makes someone
      revisit the wording instead of shipping a false diagnostic.

## 3. Baseline banner parser

Files (whole group): `packages/core/src/sql/migration-file.ts`,
`packages/core/src/index.ts`,
`packages/core/test/migration-file.test.ts`.

- [x] 3.1 (~8m) [design — settled] R5: `parseBannerBaseline` joins
      `parseBannerHashes`/`parseBannerVersion`, exported from core's
      index, following the existing parser pattern in that file — matches
      the known `BASELINE_LINE` prefix only, leaving unknown banner lines
      ignored. Returns `boolean`, not the `T | null` its two siblings
      use: for a marker, absence is a meaningful `false`, not a missing
      value. Red: `packages/core/test/migration-file.test.ts` — "reads
      the baseline marker back off a rendered banner, and reports its
      absence on an ordinary migration".

- [x] 3.2 (~6m) Lead decision (relayed 2026-08-29): the parser matches
      the **`-- baseline:` prefix only**, not the whole marker line.
      Split a `BASELINE_PREFIX` constant out of `BASELINE_LINE` (the
      renderer keeps writing the full line) and match on it, exactly as
      `parseBannerHashes`/`parseBannerVersion` match theirs. Rationale,
      now also a sentence in the cli-commands delta: whole-line matching
      couples the machine contract to human-facing prose, so a one-word
      change to the guidance makes every previously written baseline
      parse as `false` — and `false` tells an apply tool to *run* a
      migration that must only be registered. Red:
      `packages/core/test/migration-file.test.ts` — a marker line whose
      trailing guidance differs from today's is still recognized; the
      existing `[baseline notes]` false-positive guard stays green (that
      line does not start with `-- baseline:`, so prefix matching keeps
      every guard the whole-line match had — reviewer measured it: all 35
      migration-file tests stay green).
      The constant is `"-- baseline:"`, **colon-terminated, no trailing
      space** (unlike the siblings' `"-- snapshot: "`): a marker has no
      value after its colon, and a trailing space would make a future
      bare `-- baseline:` unreadable. `BASELINE_LINE` becomes a template
      built from it, so the prefix is stated once — a second hardcoded
      copy is the same drift shape as group 2's R-b.
- [x] 3.2b (~5m) R-e: R5's actual deliverable — the *public export* —
      has no test. Deleting `parseBannerBaseline,` from
      `packages/core/src/index.ts` leaves all 36 core tests green and
      `tsc --noEmit` clean, because the tests import from
      `../src/sql/migration-file` directly and the repo has no export-
      surface test. The delta says hejbro "SHALL expose a parser ...
      publicly", so at least one assertion must import the symbol from
      `../src/index`. Red: same test file, with that import.

## 4. Trigger-row dispatch

Files (whole group): `packages/core/src/plpgsql/body-context.ts`,
`packages/core/test/plpgsql/body-context.test.ts`.

- [x] 4.1 (~9m) R4: `recordReturn` checks the `triggerRowMeta` brand
      before `isReturnableExpr`'s duck-type, so a table with a column
      named `exprNode` no longer sends `ctx.return(ctx.new)` down the
      expression path. Preserve the current ordering's *effects*: a
      trigger row returned from a scalar-returning declaration must still
      fail with `scalar-return-expects-expression`, which today falls out
      of the expression branch running first. Red:
      `packages/core/test/plpgsql/body-context.test.ts` — "a trigger row
      is returned as a ref even when the table has a column named
      `exprNode`", plus the existing scalar-guard tests staying green.

- [ ] 4.2 (~5m) Two constraints from group 4's review, one comment each:
      **R-f** in the test — a trigger row cannot be handed to a scalar
      declaration through any type-legal path (the test needs
      `@ts-expect-error`), so capturing one inside a trigger body is the
      only way to reproduce it; what the test defends is that the runtime
      guard survives for consumers who bypass the types. Without that
      line the fixture reads as contrived and invites deletion.
      **R-g** on the helper — it is a `function` declaration, not an
      arrow const, because it is called in *statement* position and TS
      only narrows control flow through `never` that way. Core's other
      `never` helpers are arrows because they are only ever called in
      return/expression position. Unstated, the next person "fixes" the
      inconsistency and meets a tsc error.

## 5. Cache inputs, docs and release chore

Runs after 1–4: 5.2 quotes the codes and export names those groups
settle. Files: `packages/skills/turbo.json`,
`skills/hejbro/references/query-layer.md`, `README.md`,
`packages/cli/README.md`, `AGENTS.md`, `blackbox/*.md`,
`.changeset/*.md`, `openspec/task-times.csv`.

- [x] 5.1 (~7m) R3: `packages/skills/turbo.json`'s `test` inputs gain
      `$TURBO_ROOT$/packages/*/src/**` — the snippet test type-checks
      against those sources, so an API rename currently replays a stale
      cached PASS (#430's failure class; #431 closed only the docs half,
      and this is the likelier cause). Verified the way #431 was: with a
      warm cache, break a `packages/*/src` API the snippets use, confirm
      `pnpm test` goes red rather than replaying FULL TURBO, then revert.
      Record that reproduction in the PR body. **Run it with
      `TURBO_FORCE=1` for the baseline measurement**: the turbo cache is
      shared across worktrees, so a run in a fresh worktree happily
      replays a `FULL TURBO` log produced somewhere else entirely
      (observed in group 1's review gate, where `check-types` replayed a
      log from the main worktree's `examples/postgres`). Without that,
      this task's own verification measures the cache instead of the
      code — the same failure class it exists to close. Update the file's own
      comment to say what the inputs now cover.
- [x] 5.2 (~8m) Docs: `skills/hejbro/references/query-layer.md`'s nested
      transaction section gains the concurrency rule and both new error
      codes (a stale skill is a broken user contract). Carried over from
      group 1's review: `savepoint-rollback-failed` now carries
      **either** `callbackError` **or** `releaseError` depending on which
      path raised it, and that is user-facing — both properties belong in
      the skill, not just the code that reads best. Also from that
      review: the skill documents **no** banner parser today, so adding
      only `parseBannerBaseline` would read as an oddity. Give the three
      (`parseBannerHashes`, `parseBannerVersion`, `parseBannerBaseline`)
      one short subsection — the audience for R5 is exactly someone
      writing an apply tool, and that reader needs all three or none. `README.md`'s CLI
      list and `packages/cli/README.md`'s command block gain `baseline`,
      `history` and `restore`; `AGENTS.md`'s "three published packages"
      becomes the five-package fixed group `.changeset/config.json`
      actually declares. Verified by the snippet-compile test plus
      review, not by a new test.
- [x] 5.3 (~7m) `blackbox/2026-08-29-fix-lifecycle-review.md` (D89): the
      decision path, not a summary of the diff — the findings originate
      in an adversarial review of the day's own merges, and the four
      contract decisions (D1, D2, R2, R5) were settled by the lead under
      the owner's 2026-08-29 blanket delegation rather than by the owner
      directly. Records what was rejected too: documentation-only for D1,
      a citty unknown-flag dump for 2.2. Records what the review itself
      produced: B2/B4 (one defect class reintroduced by the very commit
      fixing it, and its mirror image on the other path — both from
      reasoning a new operation through one path only), and the three
      follow-up issues the lead filed from this change's findings —
      #447 (house TS bans not machine-enforced), #448 (turbo's shared
      worktree cache contaminating isolated review gates), #449 (a
      nested transaction racing a plain statement, scoped out here).
      Lands in this same PR.
- [x] 5.4 (~5m) Release chore: one `patch` changeset (D59 — the five
      fixed-group packages move together, so one changeset is both
      necessary and sufficient), `openspec/task-times.csv` rows for
      groups 1–5, README task-time badges (`pnpm check:tasktime`) and
      CRAP block (`pnpm check:crap`), and delete this change's
      `findings.md` scratch file.

## Housekeeping before the first commit

- Three deltas, not two: `query-execution` (D1, R2), `cli-commands`
  (D2, R5, and 2.2's flag refusal) and `plpgsql-function-bodies`. The
  third is kept because R4 does yield an observable promise — a user's
  own column name never changes what `ctx.return(ctx.new)` means — and
  that scenario is already written. Everything else (R1, R3, the nits)
  restores specified behavior and rides the plain cycle.
- `findings.md` is scratch: never committed, deleted in 5.4.

## Verification

- `pnpm check`, `pnpm check-types`, `pnpm test`, `pnpm check:crap`,
  `pnpm check:tasktime` all pass — output in the PR body.
- `pnpm --filter @hejbro/pg test:integration` against a real postgres:17,
  including 1.6's two new witnesses.
- 5.1's cache reproduction recorded in the PR body.
- Two one-off flakes were seen during review and did not reproduce:
  `@hejbro/pg`'s integration suite failed wholesale once at `beforeAll`
  (2 clean reruns), and `cli-smoke`'s e2e failed once in six runs. Both
  ran in isolated worktrees, so #102-style interference is ruled out.
  The last full run before the PR watches for either; if one recurs,
  capture the output rather than rerunning it away.
- Every delta scenario has a test paired to it. B2/B3 showed this is a
  detector, not paperwork: the one scenario without a test was where a
  reintroduced defect hid. Carry this practice into the completion
  report so it can be passed to the other review streams.
- Commits: conventional, lower-case subject ≤72 chars, each carrying
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
  Push to `upstream fix-lifecycle-review`; the PR is the lead's.
