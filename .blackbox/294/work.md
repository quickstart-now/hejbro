# Work — quickstart-now/hejbro#294

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 2026-08-26 — Blackbox adopted for this repository

_2026-08-26T00:00Z_

(AGENTS.md and the design spec are shared results of the two changes
landing in this PR — this entry and `2026-08-26-openspec-adoption.md`
pin the same final blobs.)

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

### Assistant response and decisions

Followed the dd-blackbox bootstrap path: copied the canonical README from
`skills/dd-brainstorming/blackbox/` in quickstart-now/agent-skills,
changing only the item name (`dd-brainstorming` → `hejbro`, "this skill" →
"this repository"), and recorded the adoption itself as this first entry.

Decisions made without a further owner question, each visible for review
in the PR:

- **The item unit is the repository root.** hejbro's owner-driven changes
  routinely cut across packages (core + cli + supabase version as a fixed
  group), so a per-package blackbox would split single exchanges across
  directories. A finer grain can be adopted later by the same marker — a
  `blackbox/README.md` next to the item.
- **Issue-first**: #294 (Task, sub-issue of #282) filed before the work,
  per the repository workflow.
- **D89** records the adoption in the owner-gated decision log, because
  AGENTS.md now points contributors at `blackbox/` and that pointer needs
  a *why* anchor in the log. The gate is satisfied by the owner's explicit
  adoption directive above; the PR merge is the owner's review point.
- **No backfill.** The record starts at adoption; earlier exchanges remain
  in session memory and the labs wiki, and are cited from entries when
  relevant rather than reconstructed.

### Internal processing

Read the canonical README and both existing entries in
`skills/dd-blackbox/blackbox/` (creation, content-pinning) before writing
— schema from precedent, not invented. Every `Refs:` pin was computed
with `git hash-object` on the working tree before any commit existed;
content pins need no commit and survive the repository's squash-merge
workflow.

Migrated from the single-file entry `.blackbox/2026-08-26-blackbox-adoption.md`, kept verbatim at `.blackbox/294/artifacts/2026-08-26-blackbox-adoption.md`.

<a id="w2"></a>
## W2 — 2026-08-26 — OpenSpec adopted as the spec layer (E3)

_2026-08-26T00:00Z_

(The `.claude/` files were generated verbatim by `openspec init` v1.10.0
— no local edits. AGENTS.md and the design spec are shared results with
`2026-08-26-blackbox-adoption.md`, same PR.)

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

### Prior owner decisions this change executes

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

### Assistant response and decisions

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

### Internal processing

`openspec init` was run non-interactively and its output inspected before
staging; the generated files carry no local edits, so upstream updates
can be re-applied by re-running init. Gates run in the worktree before
the PR: `pnpm check` (317 files clean), `pnpm check-types` (10/10),
`pnpm test` (11/11 — cached, no source changed vs `dev`), `pnpm
check:crap` (0 of 973 functions over CRAP 5, README numbers match),
`pnpm changeset status` (pending patch bumps only — this PR is
process/docs, no changeset required and none added).

Migrated from the single-file entry `.blackbox/2026-08-26-openspec-adoption.md`, kept verbatim at `.blackbox/294/artifacts/2026-08-26-openspec-adoption.md`.

