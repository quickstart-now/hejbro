# 2026-08-26 — OpenSpec adopted as the spec layer (E3)

Refs:
- openspec/config.yaml @ blob c07b411c444866ac68a6601291a571b9afb0337d
- openspec/task-times.csv @ blob 28b6c9091d7c0d286d1d6640a7840dbdcf2f6a95
- AGENTS.md @ blob f9dcb31547d2580be76435941c557e13a80239a9
- CLAUDE.md @ blob f99a63f4fc08992fbb6f1841c325d59ae1fbee8e
- docs/specs/2026-08-19-hejbro-design.md @ blob 41e666f9454a824c93324ed4a957f5805db6d7a1
- docs/plans/2026-08-19-roadmap.md @ blob ecfca4ebf1482f238eaf7ac0d2195ef017e49fd2
- .claude/commands/opsx/apply.md @ blob 731c78958013867395fa8dd41491dc761e100eef
- .claude/commands/opsx/archive.md @ blob d93bacad091ca08a6e7e0d54ed94a754173a4ffb
- .claude/commands/opsx/explore.md @ blob 9fbafac77e1d05546378ee1f6c19e74e2d238ab5
- .claude/commands/opsx/propose.md @ blob 97a73693b004ee4ad3d58a3736f566982e66a522
- .claude/commands/opsx/sync.md @ blob 2dd4cc3baab9e3e4e944083bed57f3ae83aaf6f2
- .claude/commands/opsx/update.md @ blob 7992927750edc71e00202856fd4744a6adc65ad7
- .claude/skills/openspec-apply-change/SKILL.md @ blob c8ada3895366d39729802b1c40389bebdf90ee89
- .claude/skills/openspec-archive-change/SKILL.md @ blob 3d0f711dbf7a1dbef88344bef0971cb84393f11f
- .claude/skills/openspec-explore/SKILL.md @ blob 2ff2f1d25cec2ab4e0fae36f6e33ef631d628f85
- .claude/skills/openspec-propose/SKILL.md @ blob b1fe02f348e78cb5c50bf9bd375d98c9ec68fc75
- .claude/skills/openspec-sync-specs/SKILL.md @ blob 90436fa8801c4d27c97430f62910b046c57d1a2f
- .claude/skills/openspec-update-change/SKILL.md @ blob 3cdef006492c7a5bd059c50399988d8583c109b9

(The `.claude/` files were generated verbatim by `openspec init` v1.10.0
— no local edits. AGENTS.md and the design spec are shared results with
`2026-08-26-blackbox-adoption.md`, same PR.)

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

## Input — start E3

> We're going to start applying dd-blackbox to hejbro. And start E3.

"E3" names the preparation step the owner and assistant defined at the
end of the previous session (2026-08-26, the OpenSpec direction session):
install and init the OpenSpec CLI, revise AGENTS.md around the
three-layer truth model, add decision rows D87+, and re-frame issues
#282/#284/#293 — to be followed by E4, the ORM spec as the first change.

## Prior owner decisions this change executes

Settled one at a time with the owner (AskUserQuestion cadence) in the
previous session and recorded there as a seven-point ledger. The verbatim
exchange predates this blackbox and was not carried forward; what follows
is the recorded decision content, rewritten in English — flagged as such
rather than reconstructed:

1. hejbro adopts OpenSpec first, before other repositories; the pilot is
   the ORM spec — #293 becomes the first change.
2. Three truth layers: `openspec/specs/` = current behavior; the design
   spec's decision log = why (owner-gated, stays outside openspec);
   `changes/` + `archive/` = the frontier. The deleted 0.2.0 roadmap's
   "plan of record" role moves to `changes/`; AGENTS.md "Read first" is
   revised accordingly; specs are never written retroactively — a
   capability gets its spec when a change first touches it.
3. Fused cycle: only work that alters an externally observable contract
   gets an openspec change; `[design]` tasks get a bounded brainstorm
   before TDD; everything runs TDD.
4. The generic skill lives in the owner's personal tooling (dd-openspec);
   hejbro's AGENTS.md self-describes the cycle for contributors — a
   public repository must not reference personal skills.
5. Team model: teams live per piece (a `tasks.md` group), run in
   parallel, at most one of each role per team, a planner per team, one
   lead per session, prefixed naming, a cap of three concurrent teams,
   and file-only state.
6. Task sizing: pure work minutes; over 10 → split, 5 or under → merge;
   no runtime intervention on a running task; durations accumulate in
   `openspec/task-times.csv`.
7. Agent tool surfaces trimmed to the minimum each role needs.

## Assistant response and decisions

- Installed `@fission-ai/openspec@latest` (1.10.0) globally and ran
  `openspec init --tools claude --language en --no-animation` in the
  worktree: `openspec/config.yaml` (schema `spec-driven`), six
  `/opsx:*` commands, six `openspec-*` skills. Added `.gitkeep` markers
  for `specs/`, `changes/`, `changes/archive/` and the empty
  `task-times.csv` ledger with its header row
  (`date,change-id,task-id,group,est_min,actual_min,waited_user_min,notes`).
- Wrote the ledger's task discipline into `openspec/config.yaml`
  (`rules.proposal`, `rules.tasks`, `operations.apply/archive`) so the
  rules are in-repo and tool-agnostic rather than living only in personal
  skills — decision 4 above applied to configuration, not just prose.
- AGENTS.md: "Read first" became the three truth layers; the "One phase
  at a time" hard rule became "Spec-driven changes" (D87) plus "Tasks are
  sized and test-bound" (D88); the done checklist gained openspec-state
  and blackbox-entry items and dropped the roadmap-update item. CLAUDE.md:
  the superpowers-cycle line became the OpenSpec `/opsx` line, with the
  superpowers cycle retained inside tasks.
- Design spec: rows D87 (adoption, three layers, change criterion, #293
  as pilot) and D88 (task and team discipline). D82/D83 stay retired.
  The eight ORM decisions are deliberately NOT written as rows here —
  they land with #293's change (E4), per the session plan.
- Roadmap: a Phase 10 section restoring the #284 shipping record that was
  lost when #292 deleted the 0.2.0 roadmap (PR #286, dev `7bbdc8b`,
  D84–D86, pending patch changeset → 0.1.2), and pointing the frontier at
  `openspec/changes/`.
- Issue tracker (no blobs to pin): #293 re-framed as the first openspec
  change; #282 re-worded from "Spec Kit pilot" to the OpenSpec/ORM
  direction; #294 filed for the blackbox adoption.

## Internal processing

`openspec init` was run non-interactively and its output inspected before
staging; the generated files carry no local edits, so upstream updates
can be re-applied by re-running init. Gates run in the worktree before
the PR: `pnpm check` (317 files clean), `pnpm check-types` (10/10),
`pnpm test` (11/11 — cached, no source changed vs `dev`), `pnpm
check:crap` (0 of 973 functions over CRAP 5, README numbers match),
`pnpm changeset status` (pending patch bumps only — this PR is
process/docs, no changeset required and none added).
