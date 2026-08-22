# Implementation Plan: Index completeness — access method, operator classes, expression indexes

**Branch**: `phase10-index-completeness` (worktree) | **Issue**: #284 (sub-issue of #282) | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-index-completeness/spec.md`

## Summary

Extend the existing `index()` builder with `.using(method)` (closed list,
D85), a per-column `op(input, opclass)` wrapper, and expression columns
(`.on(sql\`lower(${t.email})\`)`, explicit name required, D86). The
declaration gains `method` and a two-variant column entry; the snapshot gains
compact `method` / `opclass` / `expression` fields with **no format bump**
(D84); `createIndexSql` renders `using <method>` and the Postgres item
grammar; rename retargeting treats index expressions as a sixth
column-referencing field. Everything else (drop + create on change, derived
names, partial predicates) is unchanged. Technical approach per
[research.md](./research.md) R1–R14; shapes per [data-model.md](./data-model.md);
contracts in [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 5.9 strict (ESM-only, tsdown), Node ≥ 22 — house style: no `any`, no `let`/`var`, no `for`/`while`, no ternary (generated SQL and the user-facing DSL are exempt)

**Primary Dependencies**: `@hejbro/core` only (no new runtime deps); `@hejbro/supabase` gets a compile-driven touch (`indexDescription` handles the expression variant); `hejbro` CLI untouched (the `--rename` path is core)

**Storage**: snapshots — `HEJBRO_SNAPSHOT_VERSION` = 5 before and after (D84)

**Testing**: vitest — unit (`packages/core/test/dsl/index-builder.test.ts`, `table-surface.test.ts`, `table-kind-emit.test.ts`, `table-kind-diff.test.ts`, `rename-plan.test.ts`, `naming-conventions.test.ts`, `packages/supabase/test/…`), golden (`cases/table-index-methods/`, new; `cases/table-indexes/` must stay byte-identical), round-trip (`examples/postgres` step 8 on `postgres:17-alpine`, built-ins only), example chain tests; CRAP ≤ 5

**Target Platform**: Node ≥ 22 library/CLI; SQL for Postgres ≥ 12 (syntax used is ancient) — `hnsw`/`ivfflat` need pgvector at apply time

**Project Type**: library + CLI (monorepo)

**Performance Goals**: none new — `generate` stays sub-second on the examples; no I/O in core

**Constraints**: no format bump (D84); explicit lower-case identifiers (D36); no interactive prompts (D32 rule A); no apply (D12); `btree` normalized to absent (SC-004)

**Scale/Scope**: one kind (`table`), four core modules (dsl/index-builder, dsl/table, kinds/table-kind{,-emit-sql,-snapshot}, engine/rename-plan), one preset validator, one golden case, one example step, three docs files, three decision-log rows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* — re-checked 2026-08-22 after Phase 1: all PASS.

| # | Principle | Gate question | Status |
|---|-----------|---------------|--------|
| I | Core purity | No fs / DB / network in `@hejbro/core`; no new core runtime dependency | **PASS** — pure DSL/snapshot/emit/diff plumbing; zero new deps |
| II | Provider interface | Any preset change uses only the public extension interface; no core special case for a preset | **PASS** — `@hejbro/supabase` adapts to a widened public `IndexDeclaration` type; core gains no preset knowledge |
| III | Deterministic output | SQL is a pure function of (parent, next) snapshot; explicit lists & identifiers; destructive changes flag-driven; diagnostics carry `Next:` | **PASS** — emit reads snapshot only (D24); `btree` normalization keeps old projects diff-free; six new declaration-time codes, all with `Next:` (contracts/errors.md) |
| IV | Test-first, three layers | Tests named per layer; TDD order in tasks; CRAP ≤ 5 budget stated | **PASS** — unit + golden + round-trip + example named above; new functions are small pure helpers (`usingClause`, `indexColumnSql` branch, `op`, `validateIndexExpressions`) — CRAP stays ≤ 5 by construction, checked by `pnpm check:crap` |
| V | Decisions logged | "Decision-log impact" in spec is filled; nothing from *Deferred*; snapshot/format/DSL decisions proposed as D# rows | **PASS** — D84 (format policy), D85 (closed method list), D86 (expression naming) drafted in spec.md, owner-answered 2026-08-22, written to the log in the implementation PR |
| VI | Spec before code | Issue #284 exists as a sub-issue; `specs/001-index-completeness/` exists; one `patch` changeset planned (D83) | **PASS** |

## Project Structure

### Documentation (this feature)

```text
specs/001-index-completeness/
├── spec.md              # /speckit-specify output + /speckit-clarify session 2026-08-22
├── plan.md              # This file
├── research.md          # R1–R14: every design choice with rationale and alternatives
├── data-model.md        # DSL types, snapshot shape, SQL grammar, rename model, public-surface delta
├── quickstart.md        # the user-facing declare → generate → SQL example
├── contracts/
│   ├── errors.md        # codes + messages (unit-test contract)
│   ├── sql.md           # emitted SQL per golden step
│   └── snapshot.md      # JSON shape + invariants
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── dsl/index-builder.ts        # IndexMethod, op(), using(), widened asc/desc/IndexColumn/IndexColumnInput, unique-index-method check
├── dsl/table.ts                # IndexColumnDeclaration, IndexDeclaration.method, resolveIndex, validateIndexExpressions, unknown-index-column (name entries only)
├── kinds/table-snapshot.ts     # IndexSnapshot.method, IndexColumnSnapshot variants + opclass, accessors
├── kinds/table-kind.ts         # serializeIndexColumn / serializeIndexes (method, opclass, expression), compact-field helpers
├── kinds/table-kind-emit-sql.ts# usingClause, indexColumnSql expression + opclass branch
├── engine/rename-plan.ts       # retargetTableFields (index column expressions), rewriteIndexesForRename (name entries only), reference list
└── index.ts                    # export op, IndexMethod, IndexColumnDeclaration
packages/core/test/
├── dsl/index-builder.test.ts, table-surface.test.ts, table-kind-emit.test.ts, table-kind-diff.test.ts, rename-plan.test.ts, naming-conventions.test.ts
└── golden/cases/table-index-methods/{declarations.ts, steps.ts, expected/}
packages/supabase/src/validators/rls-cached-auth-outside-rls.ts   # indexDescription handles expression entries (+ test)
examples/postgres/src/steps/step-8.schema.ts, src/app.schema.ts, migrations/0008_*.sql, hejbro.snapshot.json, test/chain.test.ts
docs/guide/indexes.md (new), docs/guide/renames.md (stale paragraph), README.md (feature line), skills/hejbro/references/dsl-cheatsheet.md
docs/specs/2026-08-19-hejbro-design.md (D84–D86), docs/plans/2026-08-22-0.2.0-roadmap.md (frontier, pilot verdict)
.changeset/phase10-index-completeness.md (patch)
```

**Structure Decision**: no new files in `src/` beyond what exists — the feature is an extension of the existing index pipeline at each of its four stations (DSL → declaration validation → snapshot → emit) plus the rename plumbing; new files are tests, one golden case, one example step, one guide page.

## Decision-log impact

- Reads: D24, D32 rule A, D36, D46, D51, D57, D59, D67/D70, D81, D83.
- Proposes: **D84** (additive compact fields never bump the format; format stays 5), **D85** (closed access-method list), **D86** (expression indexes require an explicit name) — owner-answered in the 2026-08-22 clarification session; text drafted in spec.md "Decision-log impact".
- Conflicts: none.

## Implementation order (input to /speckit-tasks)

1. **Foundational**: types (`IndexMethod`, `IndexColumnDeclaration`, `IndexDeclaration.method`, snapshot types + accessors) with their unit tests; `resolveIndex` carries the new fields. `@hejbro/supabase` `indexDescription` compiles against the widened type.
2. **US1 — method**: `using()` + `unknown-index-method` + `unique-index-method` (builder tests) → `serializeIndexes` method field (diff test) → `usingClause` (emit test) → golden `table-index-methods` from-empty (method-only lines) → SC-004 regression test (existing `table-indexes` declarations serialize byte-identical).
3. **US2 — opclass**: `op()` wrapper + identifier validation (builder test) → `serializeIndexColumn` opclass (diff test) → `indexColumnSql` opclass token + ordering with desc/nulls (emit test) → golden lines.
4. **US3 — expression**: `IndexColumnInput` widening + `toDeclarationColumn` expression branch (builder test) → `validateIndexExpressions` three codes + `unknown-index-column` guard + duplicate-name derivation guard (table-surface tests) → serialize/encode (diff test) → emit expression branch (emit test) → rename: `retargetTableFields` + `rewriteIndexesForRename` + reference list (rename-plan tests) → golden step-1/step-2.
5. **Round-trip / example**: `examples/postgres` step 8 (GIN `jsonb_path_ops` + `lower(email)`), regenerate chain (`pnpm regen:examples` or manual `generate`), `pnpm roundtrip` green on `postgres:17-alpine`.
6. **Polish**: docs (guide page, cheatsheet, README line, renames.md stale paragraph), D84–D86 rows, changeset `patch`, roadmap frontier + pilot verdict, `pnpm check && check-types && test && check:crap`, `/speckit-analyze`, `/speckit-converge`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
