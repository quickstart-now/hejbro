---

description: "Task list template for a hejbro feature (project override: tests are mandatory, hejbro paths)"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: **MANDATORY** (constitution Principle IV). Every behaviour change
gets its failing test first; a task that adds production code without a
preceding test task is a template violation. Name the layer per test task:
`unit` (`packages/<pkg>/test/**/*.test.ts`), `golden`
(`packages/core/test/golden/cases/<case>/` — `declarations.ts`, `steps.ts`,
`expected/`), `round-trip` (`examples/<db>/` + `pnpm roundtrip`), or
`example` (`examples/postgres` / `examples/supabase` chain tests).

**Organization**: Tasks are grouped by user story so each story can be
implemented, tested, and merged independently (one story may be one PR).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies) — this is
  the unit handed to a subagent in `subagent-driven-development`
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions (hejbro monorepo)

- `packages/core/src/{dsl,kinds,engine,snapshot,sql,expr,query,plpgsql,types}/` — pure core; tests in `packages/core/test/`
- `packages/cli/src/{commands,…}/` — the only filesystem user; tests in `packages/cli/test/` (subprocess tests need `pnpm build --force` first)
- `packages/supabase/src/` — preset; tests in `packages/supabase/test/`
- `packages/skills/` — agent skills for hejbro users (`skills/hejbro/**`)
- `examples/postgres`, `examples/supabase` — showcase declarations + migration chain + `pnpm roundtrip`
- `docs/guide/*.md`, `README.md`, `docs/plans/2026-08-22-0.2.0-roadmap.md`, `docs/specs/2026-08-19-hejbro-design.md` (decision log §3)
- `.changeset/*.md` — exactly one per PR that changes a published package

<!--
  The tasks below are SAMPLE TASKS for illustration only. /speckit-tasks MUST
  replace them with real tasks derived from spec.md (user stories, FR-*,
  SC-*), plan.md, data-model.md, contracts/. Do not keep sample tasks.
-->

## Phase 1: Setup

**Purpose**: Anything every story needs before its first failing test — usually nothing in hejbro beyond the worktree and issue; delete the phase if empty.

- [ ] T001 Confirm issue #NNN exists as a sub-issue of the phase issue and the worktree is on `phase10-<feature>` (no code)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types / snapshot-shape / registry changes that every story depends on. A snapshot-shape change bumps `HEJBRO_SNAPSHOT_VERSION` and lands here, once, with its own failing test.

- [ ] T002 Unit test (failing) for [shared type / snapshot field] in packages/core/test/[file].test.ts
- [ ] T003 Implement [shared type / snapshot field] in packages/core/src/[file].ts

**Checkpoint**: Foundation ready — user stories can proceed in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [What this story delivers to a hejbro user]

**Independent Test**: [How to verify this story on its own — e.g. "declare X, `generate`, expected SQL matches golden case Y"]

### Tests for User Story 1 (write first, see them fail)

- [ ] T010 [P] [US1] Unit test for [DSL entry / validator] in packages/core/test/[file].test.ts
- [ ] T011 [P] [US1] Golden case `[case]` (create + alter + drop steps) in packages/core/test/golden/cases/[case]/
- [ ] T012 [US1] Round-trip / example coverage in examples/[db]/ (only if the story emits SQL Postgres has not seen from hejbro before)

### Implementation for User Story 1

- [ ] T013 [P] [US1] [DSL surface] in packages/core/src/dsl/[file].ts
- [ ] T014 [US1] [snapshot / emit / diff] in packages/core/src/kinds/[file].ts (depends on T013)
- [ ] T015 [US1] Error messages carry `Next:` (constitution III) — assert in T010
- [ ] T016 [US1] Docs: docs/guide/[page].md + skills/hejbro/references/dsl-cheatsheet.md

**Checkpoint**: US1 fully functional and testable independently; `pnpm check && pnpm check-types && pnpm test` green

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description]

**Independent Test**: [How to verify independently]

### Tests for User Story 2 (write first, see them fail)

- [ ] T020 [P] [US2] Unit test in packages/[pkg]/test/[file].test.ts
- [ ] T021 [P] [US2] Golden case `[case]` in packages/core/test/golden/cases/[case]/

### Implementation for User Story 2

- [ ] T022 [P] [US2] [change] in packages/[pkg]/src/[file].ts
- [ ] T023 [US2] Integrate with US1 components (if needed)

**Checkpoint**: US1 and US2 both work independently

---

[Add more user story phases as needed]

---

## Phase N: Polish & Before-Claiming-Done

**Purpose**: The AGENTS.md "Before claiming done" list, made into tasks.

- [ ] TXXX `pnpm check && pnpm check-types && pnpm test` — paste output in the PR
- [ ] TXXX `pnpm check:crap` — README CRAP block refreshed, no function > 5
- [ ] TXXX `.changeset/*.md` — exactly one, `patch` (D83: features ship on 0.1.x; `minor` is the owner-cut 0.2.0 milestone)
- [ ] TXXX Roadmap phase section updated (docs/plans/2026-08-22-0.2.0-roadmap.md)
- [ ] TXXX Decision log: new D# rows for every decision the spec's "Decision-log impact" section proposed (docs/specs/2026-08-19-hejbro-design.md §3)
- [ ] TXXX `/speckit-analyze` clean; `/speckit-converge` reports Converged
- [ ] TXXX PR body: `Closes #NNN`, spec directory link, commit list to be squashed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational; then parallel (one subagent per story) or P1 → P2 → P3
- **Polish (Final Phase)**: Depends on all stories

### Within Each User Story

- Tests MUST be written and MUST fail before implementation
- DSL surface → snapshot shape → emit → diff → error messages → docs
- Story complete (green, reviewed) before the next priority

### Parallel Opportunities

- All `[P]` tasks within a phase can run in parallel in separate worktrees
- Different user stories can run in parallel once Foundational is complete

---

## Implementation Strategy

- **MVP first**: Setup → Foundational → US1 → STOP and validate (review, PR)
- **Incremental**: each story is independently mergeable and carries its own tests
- **Parallel team**: after Foundational, one implementer per story; reviewer gates each PR

## Notes

- `[P]` = different files, no dependencies
- Verify tests fail before implementing; commit after each task or logical group
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
