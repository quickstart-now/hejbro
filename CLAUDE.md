# CLAUDE.md

This file guides Claude Code sessions working in this repository.

## What this project is

**hejbro** — declare everything in your Postgres database (tables, RLS,
functions, triggers, views, grants) in TypeScript, generate deterministic
migration SQL. Generic Postgres core + provider presets (Supabase first;
Neon and Nile planned). MIT-licensed open source under `quickstart-now`.

This project is **built AI-natively**: design, planning, and implementation
are done by AI agents, openly. The docs in this repo are part of that story.

## Read these before doing anything

1. `docs/specs/2026-08-19-hejbro-design.md` — the approved design spec and
   the full decision log (D1–D12). Decisions there were made explicitly by
   the project owner. Do not silently revisit them; if you hit a blocker,
   surface it and ask.
2. `docs/plans/2026-08-19-roadmap.md` — phased implementation plan and
   current progress. Phase 0 (scaffold) is done; **the next work is Phase 1**
   unless the roadmap says otherwise.

## How to work here

- **One phase at a time.** Each roadmap phase gets its own cycle:
  brainstorm remaining unknowns (if any) → detailed implementation plan
  (superpowers `writing-plans`) → TDD implementation → review → PR.
  Never start a phase by writing production code.
- Keep the roadmap current: mark phase progress there as work lands, so any
  future session can find the frontier by reading it.
- **Core purity is load-bearing**: `@hejbro/core` never touches the
  filesystem or a database. If a change needs I/O in core, the design is
  being violated — stop and reconsider.
- **The provider interface is the product**: `@hejbro/supabase` may only use
  the public extension interface. Needing a core special case means the
  interface is wrong — fix the interface.

## Conventions

- **All GitHub-facing text in English**: code, comments, README, docs,
  issues, PRs, commit messages.
- Commits: conventional commits, enforced by commitlint (husky hook).
  Format: `<type>(<scope>): <subject>` — lower-case subject, ≤72 chars.
- Formatting/linting: Biome (`pnpm check`), tabs, double quotes.
- TypeScript: strict. The owner's global `typescript-rules` skill applies to
  our own source (no `any`, no `let`/`var`, no `for`/`while`, no ternary…).
  Note: *generated SQL output* and the *user-facing DSL design* are governed
  by the spec, not by those TS style rules.
- Package manager: pnpm only. Tasks via turbo (`pnpm build`,
  `pnpm check-types`, `pnpm test`).

## Git workflow

- Base branch: `dev`. Feature branches cut from `dev`, PR back to `dev`,
  **squash merge**. PR body lists the commits to be squashed.
- Releases: `dev` → `main` PR, **merge commit** (never squash/rebase).
- Remote: `upstream` = `quickstart-now/hejbro` (org repo). Push feature
  branches to `upstream`, verify with `git ls-remote --heads upstream`.

## Hard gates (owner approval required)

- Publishing anything to npm (the `@hejbro` scope is not yet claimed —
  claiming it is an owner action).
- Adding runtime dependencies to `@hejbro/core` (the goal is zero or
  near-zero).
- Changing any decision in the spec's decision log.
- Building anything listed under "Deferred" in the roadmap.
