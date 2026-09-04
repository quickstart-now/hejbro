# Work — quickstart-now/hejbro#750

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 2026-09-04 — The #750 findings processed under the owner's delegation

_2026-09-04T00:00Z_

Context: the owner's previous session ended with the instruction to process
the external 0.2.0-pre.0 report #750 first, then the rest of the 0.2.x queue
(#412), and to stop the "path permission prompt" that kept freezing the
agent teams. This session ran four pieces to merge — the documentation pair
(#756, #757 → PR #771), the test-infrastructure piece (#673, #744 → PR
#773), `harden-reset-and-verify` (#752, #753 → PR #775) and
`fix-nile-findings` (#754, #755 → PR #780) — plus this PR (#784), the D106
round-1 correction of #775. Every design decision below was taken by the
lead under the owner's delegation and is recorded here for ratification; the
owner's own inputs are English rewrites of the Korean originals.

### Assistant answer 1

Read the checkpoint. Proposed, as the first action, applying the previous
session's diagnosis of the permission prompt (`crossSessionInbound: accept`
in the user settings) and measuring it with one test teammate before
starting #750. The owner chose "apply, measure, then #750".

### Assistant processing

Re-ran the same commands: no prompt. The test teammate's four worktree and
`/tmp` commands: no prompt. The teammate's two report messages did not
reach the lead during the turn. The lead then hit the prompt itself on a
`cd <worktree> && rg … packages/core/test` compound, and the owner pasted
its text: "rg on 'packages/core/test' after a cd would search a directory
that cannot be determined here, and a Read() deny rule is configured; only
you can approve running it anyway". The instrumentation hook logged it with
`permission_mode: bypassPermissions`. Root cause: the repository's relative
`Read(./**/node_modules/**)`-style deny rules plus a `cd` compound. The
previous session's cross-session-hold diagnosis was wrong; the setting is
harmless and stays. Later the same day the upstream cause was confirmed as
a Claude Code 2.1.259 regression (anthropics/claude-code #91848, #91683,
#91650 and others) and reverted in 2.1.260. A second, different prompt seen
on the rc reviewer's `docker rm … ; rm -rf /private/tmp/…` was the
documented critical-path removal guard (the reviewer had `cd`-ed into the
scratch directory, so the removal targeted its own working directory's
parent); that guard is not a regression and cannot be disabled.

Rules recorded (R67, R85, R66): no `cd` in compound commands, absolute
paths everywhere; never make a scratch directory the shell's cwd, remove
scratch with `find <dir> -delete`, never glob removals; teammate messages
reach the lead only when the lead's turn ends, so teams report through
files and tmux panes as well.

### Assistant answer 3

Accepted the delegation: design decisions settled by the lead, logged as
numbered rulings, surfaced to the owner on return. Processing order: #754
and #755 as one OpenSpec change (`fix-nile-findings`), #756 and #757 as a
documentation PR, then the rv and ti worktrees left by the previous session,
then #412.

### Lead rulings under the delegation

- R61 (#754 form): at a table-bound site — check constraint, index
  predicate, index expression, generated column, policy `using`/`with
  check` — a column reference renders as `"table"."column"`. Not bare:
  inside a policy's correlated subquery a bare name is captured by the
  inner row source, silently losing the correlation (later measured on
  Postgres: `tasks_1.task_id = tasks_1.id`). A same-bare-name row source in
  scope keeps the three-part form (also measured: the server accepts it).
  A Nile preset refusal was rejected — it would leave Nile users without
  CHECK constraints for a defect that is hejbro's own.
- R62 (#754 scope): references to other tables inside a subquery render
  two-part too; `from`/`join` targets stay schema-qualified; views,
  functions and the query builder are unchanged (filed as #772 for Nile
  measurement); the snapshot format is unchanged; example migration chains
  regenerate because their chain tests compare text.
- R63 (#755 declaration): `Preset.explainUnavailable?: true`, data on the
  preset, because `check` opens the vanilla `@hejbro/pg` driver and never
  sees a preset's driver decorator (#458 is open); the driver capability
  set stays at exactly two by the owner's earlier decision.
- R64 (#755 fallback): text comparison only under a declaring preset;
  equal after a fixed normalization agrees, different is reported as
  **not compared** with both texts and a restatement `Next:`, never as
  differing, because a textual difference is not evidence of a different
  meaning. R80 added a sixth normalization step — letter case outside
  quoted identifiers and string literals — after the reviewer measured the
  catalog re-rendering `is not null` as `IS NOT NULL`; SQL is
  case-insensitive outside quotes, so the step cannot change a meaning.
- R71–R77 (#753 review findings): keep the same-kind topological
  refinement on the create side as well as the drop side (R57-2), regenerate
  the goldens (measured: statement order only), state the create order in
  `cli-commands` as a MODIFIED requirement (R71 addendum); accept the
  reset.ts error re-coding fix (3.8) and the example regeneration (3.9)
  in-round (R72); "created or altered" wording and the statement-level
  sequence clause (R73); **R75 reverses R74**: the migration file name
  (slug from the first change) is derived from the pre-refinement order,
  so an ordering rule never renames a user's migrations — the R74
  acceptance of renamed example files was wrong; a cycle live witness
  (R76) and a CLI file-name witness plus a changeset sentence (R77).
- R78–R88 (this PR): D106 round 1 of #775 found B1 — with the declared
  objects applied outside hejbro and no `hejbro.migration_ledger`, `reset`
  swallowed the 42P01, committed an aborted transaction (a silent
  rollback) and printed "dropped every object … and cleared the ledger"
  with exit 0. Blocking despite being inherited, because the delta's own
  scenario is falsified by an input its WHEN admits. Correction: the ledger
  existence check runs once outside the transaction (`to_regclass`),
  nothing inside the transaction is caught, and the report says only what
  happened; a delta sentence and scenario record the no-ledger case (R83);
  the server `DETAIL` is carried and the cycle advice is additive, never
  asserting a cause (R72/R86); two uncovered guards were pinned by unit
  rows after mutants survived (R88); N4 became #776, NB2 (a table merely
  sharing the ledger's name has its rows deleted) became #783.
- R79–R82, R87 (`fix-nile-findings` reviews): three doc drifts fixed in
  the PR, the design log's D86 example left untouched because the decision
  log is owner-gated (queued for the owner: register R61 as a decision,
  refresh D86/D99); the MODIFIED requirement narrowed to what `check`
  actually compares after the constructor review measured that index
  predicates are compared by existence and generated columns by default
  text (#778 filed; #781 confirmed: a matching generated column is always
  reported as differing); D106 round 1 of #780 found B1 — normalization
  steps 3 and 4 run inside string literals, so `'"json"'` versus `'json'`
  agrees silently — plus N1/N4/N5, queued as the next correction round in
  worktree `fix-nile-d106-r1`; N3 (`NULL::text` makes every
  `notNullElements()` check permanently not compared in text mode) is
  #782 for the owner's call.
- R89–R90 (this PR's CI): `check:next-marker` failed on
  `reset.ts:504/514`. The lead's first diagnosis (inline a `Next:` literal
  at the call sites) was wrong and the planner's tripwire was right: those
  lines call a phase-tagging carrier that mints no code, and the gate's
  `findLocalThrowerNames` over-matched any `Object.assign(new Error(…))`
  helper without a literal code. The gate was refined to register a helper
  only when its declaration attaches a `code`; the registration set
  before/after differs by exactly that helper, and a mutant removing a real
  `Next:` still turns the gate red. Process rule: every `pnpm check:*`
  script in `package.json` is part of a piece's gate list, not only the
  three commands AGENTS.md names.
- Process (R81, R84, R66): brief gate lists carry the whole "Before
  claiming done" list; constructor mode's "no implementer reasoning" and a
  decision path fixed before the measurement are what produced the
  findings; teammate-to-lead messages arrive at the lead's turn boundary.

### Assistant answer 4

Prepared, then discarded, a pinned cask; proposed the native-installer path
as the brew-free alternative; confirmed the cask's `zap` stanza is the only
thing that touches `~/.claude.json*` and `~/.config/claude`, so a plain
`brew upgrade --cask` loses no settings. Recorded for the next session:
verify 2.1.260 with one teammate running the exact regression command,
then comment on anthropics/claude-code #91848 with the agent-team data
point.

### Assistant answer 5

No. It was omitted. This entry records the session's owner exchanges and
the rulings taken under the delegation, and lands in the still-open PR
#784 so the record is in the repository, as the convention requires.

Migrated from the single-file entry `.blackbox/2026-09-04-delegated-external-findings.md`, kept verbatim at `.blackbox/750/artifacts/2026-09-04-delegated-external-findings.md`.

