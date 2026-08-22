# Implementation Plan: [FEATURE]

**Branch**: `phase10-[feature]` (worktree) | **Issue**: #[NNN] (sub-issue of the phase issue) | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow. Project override: hejbro's technical context is pre-filled; the Constitution Check lists the repository's real gates.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: TypeScript 5.9 strict (ESM-only, tsdown), Node ≥ 22 — house style: no `any`, no `let`/`var`, no `for`/`while`, no ternary (generated SQL and the user-facing DSL are exempt)

**Primary Dependencies**: `@hejbro/core` (pure, no runtime deps beyond what is already there), `hejbro` CLI (zod config, only filesystem user), `@hejbro/supabase` (public extension interface only); pnpm + Turborepo + Biome + vitest + commitlint

**Storage**: none at runtime — snapshots (`hejbro.snapshot.json`, `HEJBRO_SNAPSHOT_VERSION` = [current]) and migration files are the only persisted artifacts; Postgres is touched only by the local Docker round-trip

**Testing**: vitest — unit (`packages/*/test`), golden cases (`packages/core/test/golden/cases`), round-trip (`scripts/roundtrip.sh`, two-path `pg_dump` comparison), examples as integration tests; CRAP ≤ 5 gate (`pnpm check:crap`)

**Target Platform**: Node ≥ 22 CLI/library, output SQL for Postgres ≥ [version the feature needs]; Supabase preset where relevant

**Project Type**: library + CLI (monorepo)

**Performance Goals**: `generate` stays deterministic and sub-second on the examples; no new I/O in core [or NEEDS CLARIFICATION]

**Constraints**: snapshot format changes bump the version and are a hard error across versions (pre-1.0); generated SQL explicit and lower-case identifiers (D36); no interactive prompts (D32 rule A); no apply (D12)

**Scale/Scope**: [which kinds / packages / docs this feature touches; which decision-log rows it reads or proposes]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate question | Status |
|---|-----------|---------------|--------|
| I | Core purity | No fs / DB / network in `@hejbro/core`; no new core runtime dependency (owner gate if so) | [PASS / VIOLATION → Complexity Tracking] |
| II | Provider interface | Any preset change uses only the public extension interface; no core special case for a preset | [PASS / n/a] |
| III | Deterministic output | SQL is a pure function of (parent, next) snapshot; explicit lists & identifiers; destructive changes flag-driven; diagnostics carry `Next:` | [PASS / VIOLATION] |
| IV | Test-first, three layers | Tests named per layer (unit / golden / round-trip / example); TDD order in tasks; CRAP ≤ 5 budget stated | [PASS / VIOLATION] |
| V | Decisions logged | "Decision-log impact" in spec is filled; nothing from roadmap *Deferred* without owner approval; snapshot/format/DSL decisions proposed as D# rows | [PASS / VIOLATION] |
| VI | Spec before code | Issue #NNN exists as a sub-issue; `specs/NNN-*/` exists; one changeset planned (`minor`/`patch`) | [PASS / VIOLATION] |

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── spec.md              # /speckit-specify output (+ /speckit-clarify sessions)
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output — DSL surface, snapshot shape, emitted SQL shapes
├── quickstart.md        # Phase 1 output — the user-facing "declare → generate → SQL" example
├── contracts/           # Phase 1 output — error codes/messages, golden expectations, CLI flags
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── dsl/            # table(), defineFunction(), rls, grant, index-builder, …  (DSL surface)
├── types/          # column builders, TypeNode
├── kinds/          # per-kind snapshot / emit / diff  (table-kind-*, function-kind, …)
├── engine/         # generate, rename-plan, validators
├── snapshot/       # snapshot shape, HEJBRO_SNAPSHOT_VERSION, column order
├── sql/            # statement staging, migration file, identifier rules
├── expr/ query/ plpgsql/   # expression AST, query builders, body compiler
packages/core/test/ (+ golden/cases/<case>/)
packages/cli/src/commands/   # init, generate, verify, history, restore
packages/supabase/src/       # preset: kinds, validators, auth helpers, roles
examples/postgres, examples/supabase
docs/guide/, skills/hejbro/references/, README.md
```

**Structure Decision**: [List the concrete files this feature creates or edits, per package]

## Decision-log impact

- Reads: [D# rows the design relies on]
- Proposes: [new D# rows with one-line decision + alternatives; or "none"]
- Conflicts: [any logged decision this plan would change → STOP and ask the owner; or "none"]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., new runtime dep in core] | [current need] | [why the pure alternative is insufficient] |
