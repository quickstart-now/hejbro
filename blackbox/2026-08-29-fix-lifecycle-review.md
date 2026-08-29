Refs:
- openspec/changes/fix-lifecycle-review/proposal.md @ blob 710dbc2f14f50ab9d4df6c49bb61f01991dc2c9c
- openspec/changes/fix-lifecycle-review/tasks.md @ blob 2b64892377332db0136e4fdf8b595438b8fe208f
- openspec/changes/fix-lifecycle-review/specs/query-execution/spec.md @ blob 55630e07a8919908eef863663117fa24839abecd
- openspec/changes/fix-lifecycle-review/specs/cli-commands/spec.md @ blob 58d1eea4cc4c09267c87c5b74e3290852fb5b7c1
- openspec/changes/fix-lifecycle-review/specs/plpgsql-function-bodies/spec.md @ blob 3bdc14caada0b0f6872f926edb23c145cbe5182e
- packages/query/src/db/transaction.ts @ blob ba3a9c4d719126bcff612f263fcd708c235b4ffa
- packages/cli/src/commands/generate.ts @ blob 799d52d9931560c6888677233f5aea6cd378bd75
- packages/core/src/sql/migration-file.ts @ blob d642455d5871e259f232d2bb5701de5bf04b2741
- packages/core/src/plpgsql/body-context.ts @ blob 08c8dfd1a0dbfcd7ff5af3f77642a5eb546fc067

# fix-lifecycle-review — an adversarial self-review of the day's own merges (#445)

Piece record for the whole `fix-lifecycle-review` change (tracking
#445), built by the lf team (planner sonnet / implementer sonnet /
reviewer, one round per group plus rework) in worktree `fix-lifecycle`
off dev `ad0d3f0`.

## Owner input

None directly. #445 originates in an adversarial review the lead ran
against the day's own 2026-08-29 merges (nested-transactions, `hejbro
baseline`) — not an owner request. The four contract decisions this
change makes (D1's guard shape, D2's `baseline-nothing-to-adopt` code,
R2's `savepoint-release-failed` recovery, R5's `parseBannerBaseline`
export and its `boolean` return) were settled by the lead under the
owner's 2026-08-29 blanket delegation for this class of finding, never
by the owner directly. No decision-log row: every item here is a
defect against a decision already taken, not a new one.

## What was rejected

- **D1, documentation-only.** Warning users off concurrent sibling
  `tx.transaction()` calls in a doc, instead of a runtime guard, was
  considered and rejected: silent data loss from one connection's
  interleaved `SAVEPOINT` sequence is not an acceptable outcome in
  this repository regardless of how well it's documented.
- **2.2, a citty unknown-flag dump.** Leaving `--rename`/`--confirm-drop`
  undeclared on `baseline`'s citty args and letting the parser's own
  unknown-flag error surface was rejected in favor of a pre-parse
  intercept with a hejbro-coded `baseline-flag-not-applicable` error —
  citty's own message doesn't say why the flag is inapplicable or what
  to run instead, and (measured directly) citty's `strict: false`
  parsing means an undeclared flag still reaches `rawArgs` and falls
  through to whatever the rest of the pipeline makes of it, which
  turned out to be an unrelated `unknown-rename-target`/
  `unknown-confirm-drop-target` diagnostic — worse than either option
  considered.

## What the review itself produced

Two defect classes, found across two review rounds on group 1 and one
on group 2:

- **B2/B4 — one operation reasoned through one path only, twice.**
  R1 (task 1.5) fixed `savepoint-rollback-failed`'s message asserting
  something false on the callback-throw path. The very same commit
  that added the release-failure recovery path (R2, task 1.3) reused
  that message wholesale, reintroducing the exact defect class R1 had
  just closed — "after the nested transaction callback threw" and a
  `callbackError` property on a path where the callback had returned
  normally. B4 is the mirror image on the *other* new path: task 1.4
  added a best-effort release after a successful rollback, but only
  wired the `.catch` guard into the release-failure recovery path
  (1.3), leaving the throw path's own post-rollback release (1.4)
  unguarded — a release failure there escaped as a bare
  `query-execution-failed`, losing the callback's own error entirely,
  landing in exactly the shape R2 says never to produce. Both surfaced
  because a new operation added to a shared helper or a shared
  invariant was checked against only the path that motivated it, never
  the sibling path the same commit touched. The fix in both cases was
  symmetry: parameterize the shared message helper by which path
  triggered it (`{ trigger, key }`), and make both release attempts
  best-effort alike.
- **B3 — the detector, not paperwork.** The delta scenario "A failing
  recovery rollback falls through" had no test. Writing it (closing B3)
  is what would have surfaced B2 during implementation instead of
  during review — recorded here as the standing argument for "every
  delta scenario gets a test paired to it," carried into this change's
  own verification checklist.
- One nit found in the same rounds: `let result: T;` in
  `transaction.ts` — grepped as the only `let` in the repository's own
  source, `pnpm check` blind to it since Biome ships no bare `noLet`
  rule. Fixed by normalizing the nested callback into a promise chain
  (`Promise.resolve().then(...).catch(...)`) instead of a nested
  `try`/`let`, which also covers a synchronously-throwing callback in
  one motion instead of two.
- Group 3's own defect (found by the implementer re-reading a lead spec
  update mid-piece, then confirmed by the reviewer as correct and
  independently as the intended fix): `parseBannerBaseline` first
  matched the whole rendered `BASELINE_LINE` sentence, coupling the
  machine contract to human-facing prose that may reword — a one-word
  change to the guidance text would have made every already-written
  baseline migration parse as `false`, and `false` here means "run
  this," the one thing a baseline migration must never do. Split into
  a `BASELINE_PREFIX` constant (`"-- baseline:"`, colon-terminated, no
  trailing space — a marker carries no value after its colon, unlike
  the siblings' `"-- snapshot: "`) with `BASELINE_LINE` templated from
  it, so the prefix is spelled once.
- Group 3's R-e: R5's own delta requires the parser be exposed
  *publicly*; deleting the `index.ts` export line left all 36 prior
  `migration-file.test.ts` tests green, because every one of them
  imported from the defining module directly. Closed with one
  assertion importing from `../src/index` instead.
- 5.4's own release gate: adding the R4 brand check ahead of the
  duck-type pushed `recordReturn`'s cyclomatic complexity from 5 to 6,
  failing `check:crap`'s CRAP ≤ 5 gate even at 100% coverage (CRAP
  equals plain complexity once coverage is full). Split the
  non-expression dispatch (a trigger row or a query) into its own
  `recordReturnShape`, so `recordReturn` becomes a two-branch shell and
  the CRAP gate measures each function's own complexity again, both at
  or under the threshold.
- Two more comment-only closures from review prose, landed as 2.4 and
  4.2 so the constraints outlive this PR's own tasks.md: `help.test.ts`'s
  flag-drift regex only ever matched value-taking flags (every
  `GENERATE_ARGS` entry happens to be one today); `baseline-nothing-to-
  adopt`'s flat "exported nothing" wording depends on R-d's own finding
  (no declaration kind fans out to zero snapshot changes) staying true.
  4.2 also caught its own instance of #447's own finding: the R4 delta
  test written for the group-4 rework used `let capturedRow: unknown;`
  to smuggle a trigger row out of its defining callback -- fixed to a
  mutated-object capture (`const captured: { row?: unknown } = {}`)
  before it could become a second entry in that grep.

## Follow-up issues the lead filed from this change's findings

Three, all explicitly scoped out of #445 itself:

- **#447** — the house TypeScript bans (`AGENTS.md`: no `any`, no
  `let`/`var`, no `for`/`while`, no ternary) are enforced by review
  habit, not tooling; the `let result: T;` nit above is the measured
  case where that habit alone finally slipped.
- **#448** — turbo's cache is shared across git worktrees in this
  repository; a freshly created detached review worktree replayed
  `check-types` logs from the *main* worktree's `examples/postgres` as
  a `FULL TURBO` cache hit, measured during group 1's review gate. 5.1
  (this same change) works around the general shape of this hazard for
  its own verification (`TURBO_FORCE=1` baselines) without fixing the
  cache-sharing behavior itself.
- **#449** — the milder cousin of D1, out of scope here by decision:
  `Promise.all([tx.transaction(a), tx.execute(statement)])` — a nested
  transaction racing a plain statement on the same `tx`, rather than
  two nested transactions racing each other — has no guard, and the
  same savepoint-interleaving hazard applies.

## Process record

Four groups plus rework, one commit per closed unit (never amended):
`3780fea`/`774948f` (groups 1/2 first pass) → `9c66223` (group 1
rework, B1-B4) → `00751a8` (a reviewer recommendation, cause pinned by
message content) → `db3f61d`/`9067ab2` (group 3, R5 plus its own
self-found prefix-matching defect) → `57b200b` (group 2 rework, B5 +
R-a..R-d) → `201cc48` (group 3 rework, 3.2/3.2b, plus a group 1
pairing-constraint comment carried over from review) → `17ee487`
(group 4, R4) → `60756b3` (group 5, cache input + docs catch-up).

Red observed directly for every task, not inferred: the implementation
was reverted via `git stash` (source only, tests kept) and rebuilt
before each fix, with the actual failing assertion output captured —
including, for 5.1's own cache-blind-spot fix, a live measurement in
both directions (a broken `schema()` signature replaying a stale
`FULL TURBO` PASS without the turbo.json fix, and correctly busting
the cache with it).
