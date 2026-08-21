# AGENTS.md

Guidance for AI coding agents working in this repository. Tool-agnostic:
`CLAUDE.md` imports this file; other agents read it directly.

## What this project is

**hejbro** — declare everything in your Postgres database (tables, RLS,
functions, triggers, views, grants) in TypeScript, generate deterministic
migration SQL. Generic Postgres core + provider presets (Supabase first;
Neon and Nile planned). MIT, built AI-natively under `quickstart-now`.

## Read first

1. `docs/specs/2026-08-19-hejbro-design.md` — approved design spec and
   decision log (D1–D12). Decisions were made explicitly by the project
   owner. Never silently revisit them; if blocked, surface it and ask.
2. `docs/plans/2026-08-19-roadmap.md` — phased plan and current frontier.
   Keep it current as work lands so any session can find the frontier.

## Commands

```bash
pnpm install         # pnpm only — never npm/yarn
pnpm check           # Biome lint + format check (fix: pnpm format)
pnpm check-types     # tsc via turbo
pnpm test            # vitest via turbo (harness lands in Phase 1)
pnpm build           # turbo build
```

## Repo map

| Path | Package | Constraint |
|------|---------|------------|
| `packages/core` | `@hejbro/core` | **PURE**: no fs, no DB, (near-)zero runtime deps |
| `packages/cli` | `hejbro` | User-facing DSL re-exports + CLI; the only place that touches the filesystem |
| `packages/supabase` | `@hejbro/supabase` | May only use core's public extension interface |
| `packages/skills` | `@hejbro/skills` | Agent skills for hejbro *users* |
| `examples/` | — | Real declarations doubling as integration tests |

## Hard rules

- **One phase at a time.** Each roadmap phase: brainstorm unknowns → written
  implementation plan → TDD → review → PR. Never start a phase by writing
  production code.
- **Core purity is load-bearing.** If a change needs I/O in `@hejbro/core`,
  the design is being violated — stop and reconsider.
- **The provider interface is the product.** If a preset needs a core
  special case, the interface is wrong — fix the interface.
- **All GitHub-facing text in English** (code, comments, docs, issues, PRs,
  commits).
- TypeScript strict. Our own source: no `any`, no `let`/`var`, no
  `for`/`while`, no ternary. *Generated SQL output* and the *user-facing DSL
  design* are governed by the spec, not by these style rules.
- **Naming follows the medium** (D57): snapshot self/reference fields are
  `name`/`schema`/`table`/`function`; tokens that reach generated artifacts
  are kebab-case; TypeScript-only unions stay camelCase. See
  `.claude/rules/naming.md`.

## Git workflow

- Base branch `dev`. Feature branches, PR back to `dev`, **squash merge**.
  PR body lists the commits to be squashed and references the related
  issue.
- Releases: `dev` → `main` PR, **merge commit** (never squash/rebase).
- Conventional commits, enforced by commitlint (husky):
  `<type>(<scope>): <subject>` — lower-case subject, ≤72 chars.

## Hard gates (owner approval required)

- Publishing to npm. The `@hejbro` scope is owned by the project owner
  (confirmed 2026-08-19). Since D63 the release itself runs in GitHub
  Actions, so the gate is not "who runs the publish command" but **who
  approves the release**: merging the "Version Packages" PR publishes
  immediately and irreversibly (npm burns a version number even if it is
  unpublished), and that merge is an owner action. Never merge it, and
  never change the release workflows, without the owner.
- Adding runtime dependencies to `@hejbro/core`.
- Changing any decision in the spec's decision log.
- Building anything listed under "Deferred" in the roadmap.

## Before claiming done

- [ ] `pnpm check`, `pnpm check-types`, `pnpm test` all pass — show output
- [ ] Roadmap updated if phase progress changed
- [ ] PR body lists the commits to be squashed
