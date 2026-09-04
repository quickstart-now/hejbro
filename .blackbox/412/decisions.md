# Decisions — quickstart-now/hejbro#412

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Order of attack for the 0.2.x queue

_lead · extension · 2026-09-03T00:00Z · ratified: pending_

Ledger R1.

Bugs first, then correctness gaps, then observers and tooling (including the root fix for #673), then decisions, then new capabilities. Adopted from the 09:00Z checkpoint proposal; nothing in the queue prescribed an order.

<a id="r2"></a>
## R2 — Bugs travel two to four per change and per PR; the tracking issue is the bug itself

_lead · extension · 2026-09-03T00:00Z · ratified: pending_

Ledger R2.

Bugs are grouped two to four at a time into one OpenSpec change and one PR. The group's tracking issue is the bug issue itself (already a sub-issue of #412); no change-only issue is opened. Reason: issue inflation is a cost metric.

<a id="r3"></a>
## R3 — Reviewers are summoned at group completion; cl's reviewer runs in constructor mode

_lead · interpretation · basis D110 · 2026-09-03T00:00Z · ratified: pending_

Ledger R3.

A piece reviewer is summoned when its group completes, never in advance. The cl team's reviewer runs in constructor mode because configuration files and hand-edited vendored contracts are foreign input (D110).

<a id="r4"></a>
## R4 — #500 goes to the owner's hold queue; #503 waits for a measurement

_lead · stop · basis D105 · 2026-09-03T00:00Z · ratified: pending_

Ledger R4.

#500 (recursive CTE nullability) lies in D105 territory, so it is parked for the owner rather than decided by the lead. #503 (cross-family set operations) needs a measurement first and becomes a researcher piece in a later round.

<a id="r5"></a>
## R5 — One review per piece at the branch tip; heavy gates run in a single slot

_lead · extension · 2026-09-03T08:50Z · ratified: pending_

Ledger R24.

A single-PR piece is reviewed once, at the branch tip, after every group completes — per-group reviews pay the same gate twice. The lead opens the gate slot (full `pnpm test`, Docker) to one team at a time; `check-types` and `build --force` may run outside the slot.

<a id="r6"></a>
## R6 — The build deny mismatch: canonical spellings that pass

_lead · interpretation · 2026-09-03T11:10Z · ratified: pending_

Ledger R27.

Harness defect: plain `pnpm build` / `turbo run build` were blocked in every session by a `Read(./**/build/**)` deny mismatch. Correction after fd's observation and the lead's own measurement: the block is about cwd resolution — plain `pnpm build` is matched against the session cwd (main checkout) as `./build`, while the subshell spelling `(cd <worktree> && pnpm build --force)` passes (7 tasks). Two canonical spellings: the subshell build, or `TURBO_FORCE=1 pnpm check-types`. Token-splitting workarounds are forbidden. The owner decides on adjusting the settings rule (D90 item) on return; AGENTS.md's "remedy is pnpm build --force" sentence is a candidate for an update.

<a id="r7"></a>
## R7 — Harness diagnostics after an Edit are not a compiler run

_lead · extension · 2026-09-03T11:10Z · ratified: pending_

Ledger R28.

Team rule (fd 2.2, measured): the diagnostics the harness shows after an Edit are not a compiler run and can contradict a real `tsc --noEmit` / `check-types` result (about 15 minutes lost). The only evidence for a type pin is an actual compiler run.

<a id="r8"></a>
## R8 — Mutants are applied to committed files and reverted with git checkout

_lead · extension · 2026-09-03T11:50Z · ratified: pending_

Ledger R31.

Team rule: a mutant is applied to a committed file and reverted with `git checkout --`; restoring an uncommitted state by hand is forbidden.

<a id="r9"></a>
## R9 — Diagnostics state only what the check observed

_lead · extension · 2026-09-03T12:10Z · ratified: pending_

Ledger R34.

Team rule (three fd review-round measurements): a diagnostic message and its rationale say only what the check observed; a cause may be added as "this is what X does" but never asserted. The observer that keeps that boundary is a mixed-input row such as `{ __proto__: …, realArg: … }`. Deleting the trailing clause of B1's wording ("no key declares an argument") is approved.

<a id="r10"></a>
## R10 — Badge and CRAP stamps are committed once, right before the PR, after the dev rebase

_lead · extension · 2026-09-03T12:40Z · ratified: pending_

Ledger R36.

Team rule (fd rebase conflict, measured; reconfirmed twice on qc #737): README badge and CRAP-stamp commits happen once, after the dev rebase and right before the PR — a one-line number conflicts structurally. CSV rows may land any time (append-only, auto-merged). Cause: the lead had allowed check:tasktime to run while waiting.

<a id="r11"></a>
## R11 — Never run the test suite and the type check at once in one worktree

_lead · extension · 2026-09-03T13:05Z · ratified: pending_

Ledger R40.

Team rule (fd reviewer's self-report): the suite's temporary fixtures (`_tmp-*`) become the type check's input — the #102 class of self-inflicted interference.

<a id="r12"></a>
## R12 — The final tip's heavy gates are the reviewer's one isolated run

_lead · extension · 2026-09-03T13:25Z · ratified: pending_

Ledger R41.

The heavy gates on a final tip are satisfied by the reviewer's single isolated run; the PR body's gate table names the source ("measured by the reviewer in an isolated worktree at <tip>") and the raw numbers. A team-side rerun wastes the slot; the team commits only the README regeneration once, cross-checked against the reviewer's numbers. A DIRTY PR gets no pull_request CI because GitHub cannot build the merge commit.

<a id="r13"></a>
## R13 — check:crap is a slot-only gate

_lead · interpretation · 2026-09-03T13:45Z · ratified: pending_

Ledger R42.

The lead's own mistake, measured: `check:crap` spawns `turbo run test:coverage`, so it is not a light one-off — slot only. fd's restamp and qc's reviewer ran it at once, load 44. The rule "no commit when the numbers disagree" is the line of defence.

<a id="r14"></a>
## R14 — A mutant is specified by its edit, not by a number

_lead · extension · 2026-09-03T14:10Z · ratified: pending_

Ledger R44.

Team rule (qc's 15-versus-16 measurement): two numbers that measured different edits are both right; a mutant is named by the edit it makes.

<a id="r15"></a>
## R15 — How the CRAP README stamp behaves under a rebase

_lead · interpretation · 2026-09-03T14:40Z · ratified: pending_

Ledger R46.

From reading the script: the stamp's sha and date move only when the three numbers (scanned / violations / highest) move, and the comparison is against the committed HEAD:README.md — equal numbers keep the CI diff clean even with a stale SHA. `pnpm check:crap --check` is the read-only mode (verdict plus the would-be block). Correction after the qc reviewer's objection: a manual restore of the CRAP line is valid only when the base did not change scanned sources — fd's merge did, so the shortcut is withdrawn; the canonical procedure is keep dev's README, take the reviewer's `--check` output, restamp in one commit. The lead's misjudgement is recorded.

<a id="r16"></a>
## R16 — Rebase under load: refresh the index, and after three failures merge dev instead

_lead · extension · 2026-09-03T15:20Z · ratified: pending_

Ledger R47.

Team rule (qc's rebase failed twice, then four times): a rebase under load that keeps failing at different points with "local changes would be overwritten" is a racily-clean index — run `git update-index --really-refresh` just before the rebase, once in a quiet window, on a backup branch. After three failures, `git merge upstream/dev` (a squash PR does not care about history).

<a id="r17"></a>
## R17 — While a PR is in its review-closing phase, no other merge moves dev

_lead · extension · basis R36 · 2026-09-03T15:55Z · ratified: pending_

Ledger R50.

The lead's ordering mistake: when a PR is in its review-closing phase, any other merge that moves dev (archives included) waits until that PR merges — README badges and the CSV conflict every time (R36). Freeze in force until qc #737 merged.

<a id="r18"></a>
## R18 — CI's check:crap output is an isolated measurement and may restamp the README

_lead · interpretation · basis R46 · 2026-09-03T13:05Z · ratified: pending_

Ledger R52.

The `check:crap` output of CI (node 24) — 0 of 1631, highest 5.00 — is an isolated measurement and may be used as the README restamp value without waiting for a reviewer slot (R46: equal numbers keep the diff clean). qc's tip passed the crap gate itself, so the refactor holds. Reinforcement: a manual restamp updates both the README sentence (line 223) and the shields badges (line 4) — the script rewrites both; qc's implementer caught the badge mismatch. This became the standard flow for a PR whose source changed and whose team cannot run check:crap (slot): restamp once from the first CI's measured value.

<a id="r19"></a>
## R19 — Teammate reports go to a status file; messages arrive when the lead's turn ends

_lead · extension · 2026-09-03T17:00Z · ratified: pending_

Ledger R66.

Teammate messages were not showing up for the lead, so briefs gain the rule "append the report to `.agents/status-<team>.md`, then message"; the lead reads files and tmux panes. The "no cd, no /tmp" clause is removed (the owner's correction). Amendment (17:30Z): teammate-to-lead SendMessage arrives in a batch when the lead's turn ends — 34 messages landed at once right after a turn — neither held nor lost. The file/pane rule stays, and the lead avoids long turns, ending them periodically to receive messages.

<a id="r20"></a>
## R20 — The permission prompt's real cause: relative Read deny rules after a cd

_lead · interpretation · 2026-09-03T17:08Z · ratified: pending_

Ledger R67.

The instrumentation hook recorded a Bash `PermissionRequest` under `permission_mode: bypassPermissions` for `cd <worktree> && rg … packages/core/test …`, with the prompt "rg on 'packages/core/test' after a cd would search a directory that cannot be determined here, and a Read() deny rule is configured". Cause: the repository's relative (`./`) deny rules such as `Read(./**/node_modules/**)` combined with a relative path after `cd`. The previous session's cross-session-hold hypothesis was a misdiagnosis (`crossSessionInbound: accept` is harmless and stays). Rule: no `cd` in commands, absolute paths always (`rg pattern /abs/dir`, `git -C /abs`; `pnpm --dir` and `(cd … && pnpm build --force)` are exceptions because they are not read tools). Stated in team briefs. Later relaxed to a recommendation by R91 once 2.1.260 reverted the regression.

<a id="r21"></a>
## R21 — task-times rows for a dissolved piece: derived from commit spans, source stated

_lead · extension · basis D88 · 2026-09-03T17:00Z · ratified: pending_

Ledger R69.

A sentinel row is rejected. One row per task; est from tasks.md/plan.md; actual from a stopwatch where one exists, otherwise derived from commit timestamp spans with the source stated in notes ("commit span … no stopwatch"); one commit covering several tasks is one row. Applied equally to the ti piece (lead-driven) and rv2.

<a id="r22"></a>
## R22 — Every brief's task gates are AGENTS.md's whole 'before claiming done' list

_lead · extension · 2026-09-04T00:15Z · ratified: pending_

Ledger R81.

Process, from nl: the brief's task-gate list omitted `check:crap`, `check:tasktime` and `check:bans`, so 1.1's CRAP regression (isInScope 6) reached review. From now on every brief names the whole AGENTS.md "Before claiming done" list as task gates. A separate refactor commit and a full audit of the marker misreading (TableBoundMarker read as FromNode) are approved.

<a id="r23"></a>
## R23 — Two reusable rules from nl: constructor mode for foreign input, fixed verdict paths before measuring

_lead · extension · basis D110 · 2026-09-04T00:40Z · ratified: pending_

Ledger R84.

nl dissolved. Two reusable rules: (1) constructor mode's "no implementer reasoning received" exposed a coverage promise the spec never kept (#778) — apply it to every change with foreign input; (2) fix the verdict path before measuring ("text matches + server refuses → a delta-scenario problem", three branches) — included in the brief template.

<a id="r24"></a>
## R24 — Two permission prompts confirmed: the 2.1.259 regression and the documented rm guard

_lead · interpretation · basis R67 · 2026-09-04T00:50Z · ratified: pending_

Ledger R85.

(1) The `cd X && <reader> relative-path` prompt is a Claude Code 2.1.259 regression (a prompt even in bypass when any Read deny rule exists; upstream #91848 #91683 #91650 #91776 #91853 #91837 #91811; absent up to 2.1.258) — R67's absolute-path rule stays, with a downgrade to 2.1.258 as the fallback. (2) `rm -rf <the shell's cwd, its parent, or a critical path>` is a documented always-on prompt that no allow rule or hook removes — never make scratch the cwd, clean with `find /abs -delete`, no glob deletes. Reflected in briefs and the D106 prompt template. The owner later cancelled the downgrade (keep 2.1.259, avoid by command rules).

<a id="r25"></a>
## R25 — A brief's gate list is every check:* script in package.json

_lead · extension · 2026-09-04T01:40Z · ratified: pending_

Ledger R89.

Process, from rc's red CI: `check:next-marker` (CI only) was missing from the local gate list, so PR #784 went red. From now on a brief's gate list is `pnpm check`, `check-types`, `test` plus every `check:*` script in package.json (next-marker, diagnostic-xref, first-release-version, bans, crap, tasktime, fixed-group). AGENTS.md's "Before claiming done" lacks that line — a candidate for the next documentation PR.

<a id="r26"></a>
## R26 — 2.1.260 reverts the regression: the workarounds are removed and R67 becomes a recommendation

_lead · interpretation · basis R67, R85 · 2026-09-04T04:30Z · ratified: pending_

Ledger R91.

Claude Code 2.1.260's changelog reverts 2.1.259's application of Read deny rules to Bash arguments. Measured in the lead session and in a separate teammate process (perm-probe): `cd <worktree> && rg/grep relative-path`, a worktree Read and a /private/tmp Write all ran with zero prompts and zero hook-log entries. The workaround settings are removed: the three `Bash(cd …)` allow rules and `additionalDirectories` in settings.local.json, and `crossSessionInbound` in the user settings. R67's "no cd, absolute paths only" becomes a recommendation (absolute paths still read better); R85's cleanup rule stays. This ledger is migrated in full into the `.blackbox/` issue folders (#787).

<a id="d1"></a>
## D1 — Owner input 1

_owner · 2026-09-03T00:00Z_

"The more we process, the more bugs turn up. Were all the ones handled so far legitimate bugs?"

<a id="d2"></a>
## D2 — Owner input 2

_owner · 2026-09-03T00:00Z_

"What made those bugs get found?"

<a id="d3"></a>
## D3 — Owner input 3

_owner · 2026-09-03T00:00Z_

"Why were those bugs not handled during the work that built the ORM?"

<a id="d4"></a>
## D4 — Owner input 4

_owner · 2026-09-03T00:00Z_

"Then how will you change the process so these bugs stop appearing?"

<a id="d5"></a>
## D5 — Owner input 5

_owner · 2026-09-03T00:00Z_

"Are all of those changes legitimate — not for hejbro specifically, but by general agent-workflow standards?"

<a id="d6"></a>
## D6 — Owner input 6

_owner · 2026-09-03T00:00Z_

"Where do those three get applied? Skills? Memory?"

<a id="d7"></a>
## D7 — Owner input 7

_owner · 2026-09-03T00:00Z_

"Do the work and merge it. Also: is there context that a Claude update has made unnecessary? For example, suppose Claude did not support addition and subtraction, so I built a skill for it or put it in context; then an official update added addition and subtraction — there would no longer be a reason to load that skill or context. Do I have anything like that?"

<a id="r1-ratification"></a>
## R1 accepted

_evaluator · 2026-09-04T07:21Z_

No written rule or owner decision orders the 0.2.x queue, so this is a genuine extension; bugs-then-correctness-then-tooling puts the root fix for #673 ahead of new capabilities, which matches the owner's recorded position that the #673 timeout raise was an effect-layer stopgap.

<a id="r2-ratification"></a>
## R2 accepted

_evaluator · 2026-09-04T07:21Z_

openspec/config.yaml requires each top-level group to have a tracking issue that is a sub-issue of the change's issue; reusing the bug issue itself satisfies both that and CLAUDE.local's no-orphan rule while avoiding a change-only issue, and issue inflation is a cost the owner's calibration mandate names.

<a id="r5-ratification"></a>
## R5 accepted

_evaluator · 2026-09-04T07:21Z_

The rules bind review to the piece (dd-openspec 'Review is spec-bound') but say nothing about how often a single-PR piece is reviewed or how contended machine gates are scheduled; reviewing once at the branch tip and serialising the heavy gate slot removes a duplicated cost without weakening the spec-bound review.

<a id="r7-ratification"></a>
## R7 accepted

_evaluator · 2026-09-04T07:21Z_

Nothing written says what counts as evidence for a type claim; the ruling is measured (about 15 minutes lost to contradicting harness diagnostics) and restates the house standard that a claim needs a run behind it.

<a id="r8-ratification"></a>
## R8 accepted

_evaluator · 2026-09-04T07:21Z_

Rules are silent on mutation mechanics; applying a mutant to a committed file and reverting with git checkout makes the experiment reproducible and its undo verifiable, which is the same evidence discipline dd-thinking asks for.

<a id="r9-ratification"></a>
## R9 accepted

_evaluator · 2026-09-04T07:21Z_

An extension of the diagnostics idiom the query-layer rule already governs; 'state only what the check observed, never assert a cause' is exactly dd-thinking's refutable-diagnosis standard and the owner's explicit-over-implicit preference applied to user-facing text.

<a id="r10-ratification"></a>
## R10 accepted

_evaluator · 2026-09-04T07:21Z_

Not fully an extension: D88 already makes the lead's close-out commit the single writer of the README metric block, and this ruling agrees with it while adding the missing timing detail (after the dev rebase, right before the PR), which the measured rebase conflicts justify.

<a id="r11-ratification"></a>
## R11 accepted

_evaluator · 2026-09-04T07:21Z_

AGENTS.md warns about cross-worktree cache interference (#448) but not about self-interference inside one worktree; the suite's _tmp-* fixtures becoming the type check's input is the same #102 class of self-inflicted failure and the ban is the root fix, not a retry.

<a id="r12-ratification"></a>
## R12 accepted

_evaluator · 2026-09-04T07:21Z_

AGENTS.md requires the heavy gates to pass with output shown but never says who runs them; crediting the reviewer's single isolated run, with the source and raw numbers named in the PR body, keeps the evidence explicit and avoids paying an expensive slot twice.

<a id="r14-ratification"></a>
## R14 accepted

_evaluator · 2026-09-04T07:21Z_

Rules are silent on how a mutation result is reported; naming a mutant by the edit it makes rather than by a count is what stops two correct measurements from reading as a contradiction, and it is the measured-claims standard applied to review evidence.

<a id="r16-ratification"></a>
## R16 accepted

_evaluator · 2026-09-04T07:21Z_

Nothing written covers git behaviour under heavy parallel load; the ruling names the mechanism (a racily-clean index) and fixes it at that layer with an index refresh in a quiet window, with a bounded fallback that is safe because piece PRs squash-merge.

<a id="r17-ratification"></a>
## R17 rejected

_evaluator · 2026-09-04T07:21Z_

It treats a symptom — a one-line README metric block conflicting on rebase — by freezing every other merge into dev, which serialises the up-to-three parallel piece teams team-up is built for and adds process cost the owner's calibration mandate asks to reduce; the root fix is re-running the stamp after a rebase (R10 already puts the stamp last) or making the metric block merge-safe. It may stand only as the one-off, time-boxed freeze it records, not as a standing rule.

<a id="r19-ratification"></a>
## R19 accepted

_evaluator · 2026-09-04T07:21Z_

team-up's 'all state in files' rule already points this way and the ruling makes it concrete for teammate reports, with the batching behaviour stated as measured rather than assumed; the 'no cd, no /tmp' removal is the owner's own correction, so it is not a lead revisit.

<a id="r21-ratification"></a>
## R21 accepted

_evaluator · 2026-09-04T07:21Z_

D88 fixes the ledger's columns and the pure-processing definition but not what to do when no stopwatch exists; a commit-span-derived actual with its source stated in notes is honest where a sentinel row would be a fabricated number, and rejecting the sentinel is the right call. Such rows must be excluded from estimate-convergence reading, which the notes column makes possible.

<a id="r22-ratification"></a>
## R22 accepted

_evaluator · 2026-09-04T07:21Z_

Not a new rule so much as enforcement of AGENTS.md's existing 'Before claiming done' list, which a brief had silently truncated; naming the whole list in every brief is the root fix for a CRAP regression reaching review.

<a id="r23-ratification"></a>
## R23 accepted

_evaluator · 2026-09-04T07:21Z_

Part (1) restates D110's constructor-mode rule rather than extending it, and agrees with it; part (2) — fix the verdict path before measuring — is a genuine extension that keeps a measurement from being interpreted after the fact.

<a id="r25-ratification"></a>
## R25 accepted

_evaluator · 2026-09-04T07:21Z_

AGENTS.md's 'Before claiming done' list names three commands and omits the CI-only check:* scripts, which is why PR #784 went red; deriving the gate list from package.json is the root fix and the ruling itself flags the missing documentation line.

<a id="d8"></a>
## D8 — After pre.1 ships: polish the bot avatar, then work through the oldest open issues

_owner · 2026-09-04T08:25Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#47_

"Once 0.2.0-pre.1 is deployed, let's improve the bot image a bit, and then work through the issues on page 3 of the tracker (the oldest open issues)."

Order after the release, as read by the lead: (1) the avatar polish tracked as #805, (2) the oldest open issues (tracker page 3, sorted newest first) — taken up under this queue, each in its own work item.

<a id="d9"></a>
## D9 — After the release, process the #412 queue

_owner · 2026-09-04T08:48Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#54_

"After the release, work through #412."

Read with D8 (avatar first, then the oldest issues): after 0.2.0-pre.1 ships, #805 (avatar badge) closes, then the #412 queue is processed in the order R1 already fixed — bugs, then correctness gaps, then observers and tooling, then decisions, then new capabilities — two to four bugs per change and PR (R2).

<a id="d10"></a>
<<<<<<< HEAD
## D10 — Decide against the product we are building, at the smallest scope; do not widen the work

_owner · 2026-09-04T13:53Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#121_

"Don't widen the work too much. When there is a decision to make, remind yourself what we are trying to build, and then decide."

The lead's decision rule for the delegated queue: before ruling, restate the product — hejbro is the owner's production tool for declaring a Postgres database in TypeScript and generating deterministic migrations; the test of any surface is "does it cover my database" — and pick the option that serves that, at the smallest scope that fixes the issue at hand. No new work is opened from a decision beyond the issue it settles; anything wider is filed, not built.

<a id="d11"></a>
## D11 — The boundary is hejbro's purpose, not the smallest diff

_owner · 2026-09-04T13:54Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#122_

"I did not say 'minimal fix'. I said: handle things within the scope of what hejbro pursues and what its goals are."

Correction of the lead's reading of D10 on this branch (the decision rule): the boundary is the product's purpose, not the smallest diff. When a decision comes up, restate what hejbro is for — the owner's production tool for declaring a Postgres database in TypeScript with deterministic migrations; the test is "does it cover my database" — and choose what serves that purpose, fully, inside that category. Work that falls outside hejbro's purpose is what "widening" means; a complete fix inside it is not.
=======
## D10 — 0.2.0-pre.1 npm publish approved: the owner told the lead to press the environment review

_owner · 2026-09-04T12:16Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#112_

"Handle it directly." — said when the lead reported that the 0.2.0-pre.1 `release-publish` run was waiting at the `npm` environment review, the one irreversible release step reserved for the owner.

Read by the lead as the owner's approval of this publish, with the lead pressing the button on the owner's behalf: the deployment review was approved through the API with the comment "approved by the owner in conversation ('handle it directly'), pressed by the lead", and the seven packages shipped as 0.2.0-pre.1. The gate itself is unchanged: the next release needs the owner's word again.
>>>>>>> 5e3e68f5 (chore(blackbox): li batch folders and rulings (783 r1-r4, 797 r1))

