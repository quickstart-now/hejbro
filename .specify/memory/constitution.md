<!--
Sync Impact Report
- Version change: (none) → 1.0.0 (initial ratification)
- Modified principles: n/a (first version)
- Added sections: Core Principles (I–VI), Technical Constraints,
  Development Workflow & Quality Gates, Governance
- Removed sections: n/a
- Templates requiring updates:
  ⚠ .specify/templates/overrides/plan-template.md — Constitution Check
    must list the gates in Principle I, II, IV, V and the workflow gates
  ⚠ .specify/templates/overrides/tasks-template.md — tests are mandatory
    (Principle IV), not optional
  ⚠ .specify/templates/overrides/spec-template.md — add the
    "Decision-log impact" section (Principle V)
- Follow-up TODOs: none
- Source of every rule below: AGENTS.md (hard rules, hard gates, "Before
  claiming done"), docs/specs/2026-08-19-hejbro-design.md §3 (decision
  log), §6–§8, and docs/plans/2026-08-19-roadmap.md "Deferred". No
  standard was invented for this document.
-->

# hejbro Constitution

hejbro declares everything in a Postgres database (tables, RLS, functions,
triggers, views, grants) in TypeScript and generates deterministic migration
SQL from the diff. This constitution states the principles every feature,
plan, and review in this repository MUST satisfy. It does not restate
decisions: the decision log in `docs/specs/2026-08-19-hejbro-design.md` §3
(D1–D81 at ratification) is the single source of truth for *what was
decided*; this document governs *how work is done* and which lines are not
crossed.

## Core Principles

### I. Core purity is load-bearing

`@hejbro/core` performs no I/O: no filesystem, no database connection, no
network, (near-)zero runtime dependencies. Every capability of core MUST be
a pure function of declarations and snapshots. A change that needs I/O in
core means the design is being violated — stop and reconsider, do not add
the I/O. Adding a runtime dependency to core is an owner-approved hard gate.
`hejbro` (the CLI package) is the only package that touches the filesystem.
Rationale: purity is what makes `generate` deterministic, CI-friendly, and
testable by golden files (Principle IV); it is also the guarantee users rely
on when they let an agent run hejbro (D6, D12).

### II. The provider interface is the product

Presets (`@hejbro/supabase`, and the Neon / Nile presets the design keeps a
door open for) MAY use only core's public extension interface: kinds,
validators, expression helpers. If a preset needs a special case inside
core, the interface is wrong — fix the interface, never the core. Presets
MUST NOT declare into provider-managed schemas; they reference them
(`existingTable`, D38/D41). Rationale: generic Postgres core + presets is
the D5 positioning; one special case in core breaks every future preset.

### III. Deterministic, reviewable, non-destructive output

Generated SQL is a pure function of (parent snapshot, next snapshot):
explicit column lists (never `select *` / `returning *`), explicit,
lower-case identifiers (D36), stable ordering (physical column order, D81),
kind-dependency staging. hejbro MUST NOT apply migrations, MUST NOT connect
to a database, and MUST NOT prompt interactively: renames and drops are
flag-driven (`--rename`, `--confirm-drop`) and an ambiguity is a structured
error with a ready-to-run command (D32 rule A, §7). Every diagnostic states
*why* and *what to do next* as a pair; when there is more than one remedy
the message ends with `Next, pick one:` and runnable commands (#220).
Rationale: the product pitch is "the safe middle ground between letting AI
touch your database and writing raw SQL" — a generated migration MUST be
reviewable as a diff and MUST never destroy data silently.

### IV. Test-first, three layers, CRAP ≤ 5 (NON-NEGOTIABLE)

Implementation follows TDD: the failing test is written and seen to fail
before production code. Coverage comes in three layers (spec §8): golden
files (declaration → SQL), a real Postgres round-trip (two-path `pg_dump`
comparison, D48/D49), and the `examples/` projects as integration tests
(D53). No function exceeds CRAP 5; the gate runs in CI and the README CRAP
block is kept current by `pnpm check:crap`. Work is not "done" until
`pnpm check`, `pnpm check-types`, and `pnpm test` pass and the output is
shown. Rationale: core purity (I) makes this layer cheap; the dogfood pass
(Phase 9, D80) showed that the one blind spot — executing the result — is
exactly where defects hid, so the layers are kept, not trimmed.

### V. Decisions are explicit, logged, and owner-approved

Every design decision lives in the decision log with alternatives and
rationale. Nobody silently revisits a logged decision: if a plan needs to
change one, it surfaces the conflict and asks the owner. Anything under the
roadmap's *Deferred* list (apply command, live drift check, hybrid
authoring, client type generation, Neon / Nile presets) is not built
without owner approval. Publishing to npm is owner-gated (the four
touches). A spec that touches or proposes a decision MUST name it
("Decision-log impact"). Rationale: the log is how a fresh session inherits
the owner's intent; an unlogged decision is a decision that gets re-made
differently next week.

### VI. Spec before code, one feature at a time

No phase and no feature starts with production code. The "what" is written
first (constitution check → specification → clarifications → plan →
tasks), then the "how" runs as test-first implementation, review, and a
squash-merged PR. One feature = one issue (issue-first; sub-issue of its
phase), one `specs/NNN-<feature>/` directory, one or more PRs that
reference both. Every PR that changes a published package carries exactly
one changeset (D59). Rationale: hejbro is built AI-natively (D11) — the
written artifacts are how humans review agent work and how agents resume
it.

## Technical Constraints

- **Language & style**: TypeScript strict. Our own source: no `any`, no
  `let` / `var`, no `for` / `while`, no ternary (owner's `typescript-rules`
  skill). *Generated SQL* and the *user-facing DSL* follow the design spec,
  not these style rules.
- **Naming follows the medium** (D57): snapshot self/reference fields are
  `name` / `schema` / `table` / `function`; tokens that reach generated
  artifacts are kebab-case; TypeScript-only unions stay camelCase.
- **Toolchain**: pnpm only (never npm/yarn), Turborepo, Biome, tsdown
  ESM-only output, Node ≥ 22 (D13); commitlint conventional commits via
  husky.
- **Packages**: `@hejbro/core` (pure), `hejbro` (CLI + DSL re-exports, the
  only filesystem user), `@hejbro/supabase` (public extension interface
  only), `@hejbro/skills` (agent skills for hejbro users), `examples/`
  (real declarations doubling as integration tests). The three published
  packages version together as a fixed changeset group.
- **Language of record**: all GitHub-facing text (code, comments, docs,
  issues, PRs, commits) is English.

## Development Workflow & Quality Gates

- **Cycle per feature (from 0.2.0)**: `/speckit-specify` → `/speckit-clarify`
  → `/speckit-plan` (Constitution Check gate) → `/speckit-tasks` →
  implementation with the superpowers cycle (TDD, subagent-driven
  development, code review, worktree, PR) → `/speckit-analyze` before
  implementation starts, `/speckit-converge` before the feature closes.
  `/speckit-implement` and `/speckit-taskstoissues` are not used: execution
  belongs to the repository's own agent team, and issues are created only
  through the repository's issue workflow (type, label, assignee, parent,
  board).
- **Branching**: base branch `dev`; feature work in a git worktree, never
  in the main checkout; PRs are squash-merged to `dev` with the commit
  list in the body; releases are `dev` → `main` merge commits.
- **Gates before "done"** (in this order): tests first and failing, then
  green; `pnpm check`, `pnpm check-types`, `pnpm test` output shown; CRAP
  block refreshed; roadmap updated if phase progress changed; PR body
  lists the commits to be squashed and references its issue; one changeset
  if a published package changed.
- **Constitution Check in every plan**: Principle I (no I/O in core, no new
  core runtime dependency), II (preset uses only the public interface),
  III (no apply, no prompt, explicit SQL, flag-driven destructive changes),
  IV (test layers named, CRAP budget), V (decision-log impact stated;
  nothing from *Deferred* without approval), VI (issue + spec directory
  exist). A violation is either removed or justified in the plan's
  Complexity Tracking table and approved by the owner.

## Governance

- This constitution governs process and non-negotiable lines; the decision
  log governs decisions. Where this document and the decision log appear to
  conflict, the decision log wins and this document is amended.
- Amendments are PRs to `dev` approved by the project owner; each amendment
  bumps the version (MAJOR: a principle removed or redefined; MINOR: a
  principle or section added or materially expanded; PATCH: wording) and
  prepends a Sync Impact Report.
- Compliance is checked at two points: `/speckit-plan`'s Constitution Check
  and code review. Reviewers MUST name the principle when they block.
- Runtime guidance for agents lives in `AGENTS.md` (imported by
  `CLAUDE.md`); this document does not replace it.

**Version**: 1.0.0 | **Ratified**: 2026-08-22 | **Last Amended**: 2026-08-22
