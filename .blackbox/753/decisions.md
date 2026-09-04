# Decisions — quickstart-now/hejbro#753

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — rv artifacts approved with conditions; the [design] rulings for reset ordering and verify

_lead · extension · 2026-09-03T15:05Z · ratified: pending_

Ledger R57.

The five draft files (proposal, tasks, migration-apply / cli-commands / preset-validation deltas) are approved, adopting the narrowed root causes (#753 = FK order within one kind plus an uncaught failure; #752 = one missing `validators` argument). (1) `ObjectKind` gains an optional member `dependsOnIdentities(node): ReadonlyArray<string>` on the `ownerTableIdentity` pattern, self-references excluded and duplicates removed — a public surface, so skills/hejbro must be updated. (2) It applies to both create and drop. (3) A cycle is not a new core error code (proposal rejected): topological refinement never throws; members of a cycle keep the existing identity order as a stable tie-break. FKs are a deferred phase, so a mutual FK pair is a legal declaration that creates fine today — throwing on create would be a regression; on drop, the database's refusal surfaces as the coded `reset-drop-failed` of point 4, stated in the spec. `cyclic-object-dependency` is not introduced. (4) `reset-drop-failed`, reusing execute.ts's helper and its draft wording, approved. (5) verify reports every refusal, not only the first: it must print the same line with the same code as generate so the "same error" scenario holds for many refusals too; the check count stays one. (6) nile is added as a cli devDependency (an extension, not a rejection): the external report's example (`nile-tenant-primary-key-missing`) has to enter the input table as it is (D110); one supabase refusal and a no-preset control stay; the vitest alias mirrors supabase's. (7) Delta wording: process narration such as "already holds" becomes present-tense contract sentences; the cli-commands preset scenario drops "before any other outcome is reported" (it contradicts a sixth check); the proposal's Breaking line becomes "none" per point 3. (8) The 1.5 Docker witness keeps `live-witness.integration.test.ts`'s image and gating.

<a id="r2"></a>
## R2 — The 1.5 witness gate is the single image 17; PG 15 is one ad-hoc observation

_lead · interpretation · basis R57 · 2026-09-03T17:00Z · ratified: pending_

Ledger R68.

rv2's 1.5 witness gate is the single image 17 (R57-8 and tasks.md as written, file unchanged); PG 15 gets one ad-hoc observation recorded only in status-rv2.md.

<a id="r3"></a>
## R3 — skills/hejbro gains the extension-interface reference

_lead · interpretation · basis R57 · 2026-09-03T17:00Z · ratified: pending_

Ledger R70.

skills/hejbro had no reference for preset authors (a false premise in the handoff). `skills/hejbro/references/extension-interface.md` is created — one line per optional `ObjectKind` member (dependsOn, dependsOnIdentities, noCatalogObjectReason, ownerTableIdentity, …, only members that are actually exported) — plus one line in SKILL.md's references. links.test.ts is the definition of done.

<a id="r4"></a>
## R4 — Refinement also reorders creates: the create-order SHALL goes into cli-commands

_lead · interpretation · basis R57 · 2026-09-03T18:00Z · ratified: pending_

Ledger R71.

rv2's tripwire: group 1's same-kind topological refinement also changes the create order, turning two core goldens red (the earlier gate had not included the golden suite). Verdict: R57-2 stands (create and drop both); one create-order SHALL sentence is added to the delta; goldens regenerated (measured as an order-only change); validate --strict and show --diff rerun. nl's 1.2/1.3 gate scope is approved (workspace-wide green returns in 1.4). Amendment: the create-order SHALL belongs in `cli-commands`'s "Migrations are generated deterministically from declarations" as MODIFIED (requirement restated in full plus one ADDED scenario), while the `migration-apply` reset requirement only refers to "the reverse of the generation order" — a placement for the D106 evaluator, who reads deltas only.

<a id="r5"></a>
## R5 — 3.8 rethrow and 3.9 example regeneration approved after the fact; rv2 merges before nl rebases

_lead · interpretation · 2026-09-03T19:00Z · ratified: pending_

Ledger R72.

From the reviewer's first round: 3.8 (reset.ts's catch re-coded a HejbroError so `reset-migration-not-singular` was unreachable → rethrow, plain cycle) and 3.9 (regenerate the example migrations, snapshot unchanged, order-only change demonstrated, chain hash verified) are approved after the fact. Example migrations overlap with nl: rv2's PR merges first, nl's 1.4 rebases and regenerates afterwards.

<a id="r6"></a>
## R6 — Regenerated example migrations may rename files (superseded by R75)

_lead · interpretation · basis R71 · 2026-09-03T20:30Z · ratified: pending_

Ledger R74.

Regenerating the example migrations renames files as well (the slug derives from the first change): accepted as a consequence of the order contract, via `git mv`, with the condition that the content is an order swap only, the snapshot unchanged and verify green; spec unchanged; one line in the PR body. Superseded by R75 the same evening.

<a id="r7"></a>
## R7 — Slugs derive from the pre-refinement order; refinement affects execution order only

_lead · extension · basis R71 · 2026-09-03T22:00Z · ratified: pending_

Ledger R75.

Regeneration renamed an example file (0004_add_task_schedules → 0004_alter_tasks), which R74 had accepted. Replaced by option B: the slug is derived from the order before topological refinement (kind + identity); refinement applies to execution order only. Task 3.10 is added (chain test green on existing file names plus a unit test that refinement leaves the slug alone) and one clause goes into the cli-commands delta. nl may proceed with 2.1–2.3 while waiting for 1.4b (group 2's review after group 1 passes).

<a id="r8"></a>
## R8 — A live cycle witness is required (3.10); slug separation becomes 3.11

_lead · extension · basis R57 · 2026-09-03T22:00Z · ratified: pending_

Ledger R76.

The cycle live witness (3.10) is approved after the fact; R75's slug separation is renumbered 3.11. Order: 3.9 (R75 way) → 3.11 → 3.8 → 3.10 → merge-in → gates → review round 2.

<a id="r9"></a>
## R9 — Round-2 review: the chain test is not the 3.11 witness; the E2E probe becomes a real test

_lead · interpretation · 2026-09-03T22:20Z · ratified: pending_

Ledger R77.

The reviewer's recommendations are adopted: A — the chain test is not the witness for 3.11, so the description is corrected and the end-to-end probe becomes a formal test; B — the changeset gains one sentence on the change in generate's output. Gates reconfirmed, then the PR.

<a id="r10"></a>
## R10 — D106 rv round 1: the silent-rollback finding blocks; the correction team's scope

_lead · interpretation · basis D106 · 2026-09-03T23:05Z · ratified: pending_

Ledger R78.

D106 rv R1 = B1 / NB5 / OK6. B1: on a database without the ledger table, `reset` swallowed 42P01 and COMMITted an aborted transaction — a silent rollback with a "dropped everything" message and exit 0. Inherited, but it refutes a delta sentence, so it stays BLOCKING. Correction team `rc` (worktree `fix-reset-d106-r1`, base e22ea237, evaluation.md committed): 4.1 B1 (probe the ledger's existence with `to_regclass` first; if absent, drop only and say so honestly; never swallow an error inside the transaction; add the live case) · 4.2 N2+N3 (`reset-drop-failed` includes the server DETAIL; a Next when the dependency is inside the declaration) · 4.3 N1's delta wording ("reverse dependency order") plus N5's skills documentation (reset order, errors, cycles) · 4.4 the round-1 disposition in evaluation.md plus a patch changeset. N4 (verify does not show generate's warnings) becomes an issue under #412 (#776). The old rv worktree is removed (corpus and status files moved to the new one).

<a id="r11"></a>
## R11 — The corrected behaviour is stated in the migration-apply delta; corrections C1–C6 approved

_lead · interpretation · basis R78 · 2026-09-04T00:30Z · ratified: pending_

Ledger R83.

The behaviour B1 fixed (declared objects are dropped even on a database without the ledger table, with no claim of clearing the ledger) is added to the migration-apply delta as a sentence and a scenario. Corrections C1–C6 approved (C5: an additive branch in the Next wording).

<a id="r12"></a>
## R12 — rc review passed: in-round fixes, one issue for the same-name table deletion, corpus candidates

_lead · interpretation · 2026-09-04T01:00Z · ratified: pending_

Ledger R86.

rc's review passed with no blocking and five non-blocking findings: 4.5 in-round (NB1 failure-point wording plus advice gated on 2BP01, NB3 an overstated changeset, NB4 advice order); NB2 (rows of an unrelated table that merely shares the ledger's name get deleted — needs a shape check and a coded refusal) becomes an issue under #412 (#783); NB5 no action; seven corpus candidates go to #742 as a comment.

<a id="r13"></a>
## R13 — rc 4.5 reconfirmed: two unpinned guards fixed in-round, reviewer recheck skipped

_lead · interpretation · 2026-09-04T01:20Z · ratified: pending_

Ledger R88.

Two unpinned guards (a 2BP01 without detail, the unknown-phase wording) are pinned in-round with two unit rows; the reviewer's recheck is skipped (the planner confirmed the files) → merge-in → close-out → PR.

<a id="r14"></a>
## R14 — The CI failure re-diagnosed: the next-marker gate over-matched a phase-tag helper

_lead · interpretation · 2026-09-04T01:50Z · ratified: pending_

Ledger R90.

The lead's first diagnosis was wrong: reset.ts:504/514 are `throwPhaseTagged(phase, error)`, a code-less phase-tag helper, and `check-next-marker.mjs`'s `findLocalThrowerNames` over-matched the `Object.assign(new Error(` shape as a thrower. Option B adopted: refine the gate (a helper counts only when its declaration body attaches a code) with a mutant proof, as a separate `chore(ci)` commit.

<a id="r1-ratification"></a>
## R1 accepted

_evaluator · 2026-09-04T07:22Z_

Extends the ObjectKind extension interface rather than special-casing core for a provider, which is exactly what .claude/rules/provider-preset.md asks for; refusing a cyclic-object-dependency error code keeps a legal mutual-FK declaration working and surfaces the database's own refusal as a coded reset-drop-failed, matching the owner's detect-and-report stance over prevention features. Point 5 (verify reports every refusal, same code as generate) is consistent with D34's purpose, and nile as a cli devDependency is allowed by the preset rule's runtime-only prohibition and required by D110's input-table rule.

<a id="r7-ratification"></a>
## R7 accepted

_evaluator · 2026-09-04T07:22Z_

Rules are silent on the relationship between execution order and migration slugs; separating them at the source — slugs from the pre-refinement order, refinement affecting execution only — is a root-level fix that keeps committed example filenames stable instead of accepting a rename after the fact.

<a id="r8-ratification"></a>
## R8 accepted

_evaluator · 2026-09-04T07:22Z_

A tasks.md amendment no written rule governs; requiring a live cycle witness turns the cycle claim into something measured against a real server rather than asserted, and the renumbering is bookkeeping.

