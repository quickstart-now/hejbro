# 2026-08-26 — Blackbox adopted for this repository

Refs:
- blackbox/README.md @ blob 96920cf577cd3b51204f5d5e3df491466b0f02de
- AGENTS.md @ blob f9dcb31547d2580be76435941c557e13a80239a9
- docs/specs/2026-08-19-hejbro-design.md @ blob 41e666f9454a824c93324ed4a957f5805db6d7a1

(AGENTS.md and the design spec are shared results of the two changes
landing in this PR — this entry and `2026-08-26-openspec-adoption.md`
pin the same final blobs.)

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

## Input — adopt the convention

> We're going to start applying dd-blackbox to hejbro. And start E3.

The second sentence drives the OpenSpec adoption recorded in
`2026-08-26-openspec-adoption.md`; this entry records the first.

## Assistant response and decisions

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

## Internal processing

Read the canonical README and both existing entries in
`skills/dd-blackbox/blackbox/` (creation, content-pinning) before writing
— schema from precedent, not invented. Every `Refs:` pin was computed
with `git hash-object` on the working tree before any commit existed;
content pins need no commit and survive the repository's squash-merge
workflow.
