# Tasks: Index completeness — access method, operator classes, expression indexes

**Input**: Design documents from `/specs/001-index-completeness/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/{errors,sql,snapshot}.md, quickstart.md

**Tests**: **MANDATORY** (constitution Principle IV). Every behaviour change gets its failing test first. Layers: `unit` (`packages/<pkg>/test/**/*.test.ts`), `golden` (`packages/core/test/golden/cases/<case>/`), `round-trip` (`examples/postgres` + `pnpm roundtrip`), `example` (chain tests).

**Organization**: by user story; US1 → US2 → US3 are independently mergeable but share the Foundational types, so one PR with three reviewable commits per story is the default; splitting into three PRs is allowed if review size demands.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task — the unit handed to a subagent
- **[Story]**: US1 (method), US2 (opclass), US3 (expression)
- Exact file paths in every description

## Path Conventions (hejbro monorepo)

- core DSL `packages/core/src/dsl/`, kinds `packages/core/src/kinds/`, engine `packages/core/src/engine/`; core tests `packages/core/test/`
- golden `packages/core/test/golden/cases/table-index-methods/` (new) — `UPDATE_GOLDEN=1 pnpm test --filter @hejbro/core` records; review the diff
- preset `packages/supabase/src/validators/`, tests `packages/supabase/test/`
- example `examples/postgres/`; round-trip `pnpm --filter @hejbro/example-postgres roundtrip` (or `cd examples/postgres && pnpm roundtrip`; needs `pnpm build` and Docker)
- docs `docs/guide/`, `README.md`, `skills/hejbro/references/dsl-cheatsheet.md`, `docs/specs/2026-08-19-hejbro-design.md`, `docs/plans/2026-08-22-0.2.0-roadmap.md`, `.changeset/`

---

## Phase 1: Setup

- [ ] T001 Confirm #284 is a sub-issue of #282 and `In Progress`; worktree `../hejbro-worktrees/phase10-index-completeness` on branch `phase10-index-completeness` (based on `phase10-speckit` until #285 merges, then rebase onto `dev`); `pnpm install` done (no code)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the widened public types every story depends on; no behaviour yet. All compact / optional, so every existing test stays green.

- [x] T002 Unit test (failing): `IndexMethod` union is exported and `IndexDeclaration` carries `method: null` by default; `IndexColumnDeclaration` accepts `{ name }` and `{ expression }` variants with `opclass: null` — in packages/core/test/dsl/index-builder.test.ts (expression variant moved to US3 — see commit 20544d2)
- [x] T003 Add `IndexMethod`, `IndexColumnDeclaration` (two-variant + `opclass`), `IndexDeclaration.method` in packages/core/src/dsl/table.ts; `resolveIndex` carries `method` and the new column fields; export `IndexMethod`, `IndexColumnDeclaration` from packages/core/src/index.ts (expression variant moved to US3 — see commit 20544d2)
- [x] T004 [P] Unit test (failing): `IndexSnapshot.method?`, `IndexColumnSnapshot` variants + `opclass?`, accessors `indexMethod` (→ `"btree"` when absent), `indexColumnOpclass`, `indexColumnExpression`, `isExpressionIndexColumn` — in packages/core/test/table-kind-diff.test.ts (expression variant moved to US3 — see commit 20544d2)
- [x] T005 [P] Add the snapshot types and accessors in packages/core/src/kinds/table-snapshot.ts (compact: absent = default; `HEJBRO_SNAPSHOT_VERSION` untouched — assert in the test that it is still 5) (expression variant moved to US3 — see commit 20544d2)
- [x] T006 Unit test (failing) then fix: `@hejbro/supabase` `indexDescription` renders an expression entry as `(<expression>)` and a named entry as today — packages/supabase/test/rls-cached-auth-outside-rls.test.ts, packages/supabase/src/validators/rls-cached-auth-outside-rls.ts (compile-driven by T003) (moved to US3 — see commit 20544d2)
- [x] T007 SC-004 regression test: serialize `packages/core/test/golden/cases/table-indexes/declarations.ts` through `buildSnapshot` and assert byte-equality with its committed `expected/snapshot.json`; also `pnpm test` must show every existing golden `expected/*` unchanged — in packages/core/test/table-kind-diff.test.ts (split into two tests — expected/snapshot.json is post-steps.ts, not declarations.ts alone)

**Checkpoint**: `pnpm check && pnpm check-types && pnpm test` green; no golden file changed

---

## Phase 3: User Story 1 — Access method (Priority: P1) 🎯 MVP

**Goal**: `index().using("gin").on(t.data)` → `create index … using gin (…)`; `btree` normalized; unknown / unique-non-btree rejected at declaration.

**Independent Test**: contracts/sql.md from-empty method lines; golden `table-index-methods` step-1 method change = drop + create; `index().unique().using("gin")` throws `unique-index-method`.

### Tests for User Story 1 (write first, see them fail)

- [x] T010 [P] [US1] Unit: `.using()` records `method`; `using("btree")` → `method: null`; `using("gim")` throws `unknown-index-method` with the eight-name list; `.unique().using("gin").on(…)` and `.using("gin").unique().on(…)` throw `unique-index-method`; messages match contracts/errors.md up to `Next:` — packages/core/test/dsl/index-builder.test.ts (unnamed-case wording corrected per owner decision — see contracts/errors.md)
- [x] T011 [P] [US1] Unit: `tableKind.serialize` writes `method: "gin"` and omits it for btree/null — packages/core/test/table-kind-diff.test.ts
- [x] T012 [P] [US1] Unit: `createIndexSql` renders ` using gin` after the table name and nothing for btree; `emitAlter` drops + creates on a method change under the same name — packages/core/test/table-kind-emit.test.ts
- [x] T013 [US1] Golden: create `packages/core/test/golden/cases/table-index-methods/{declarations.ts,steps.ts}` with the `docs` table (gin/brin/hash lines of contracts/sql.md; opclass/expression lines are added in US2/US3) and a step-1 method change; record `expected/` with `UPDATE_GOLDEN=1`, review that from-empty and step-1 match contracts/sql.md

### Implementation for User Story 1

- [x] T014 [US1] `IndexBuilder.using(method)` + `IndexMethod` runtime guard (`unknown-index-method`) + `unique-index-method` check in `.on()`; `createIndexBuilder(indexName, unique, method)` — packages/core/src/dsl/index-builder.ts
- [x] T015 [US1] `serializeIndexes`: `...methodField(index.method)` compact helper next to `indexUniqueField` — packages/core/src/kinds/table-kind.ts
- [x] T016 [US1] `usingClause(index)` in `createIndexSql` — packages/core/src/kinds/table-kind-emit-sql.ts
- [x] T017 [US1] `naming-conventions.test.ts` passes with `method` values verbatim (confirmed: the test only scans `*Kind`-suffixed discriminator keys, `method`/`opclass` are structurally out of scope — no allowlist edit) — packages/core/test/naming-conventions.test.ts

**Checkpoint**: US1 green; golden `table-indexes` still byte-identical

---

## Phase 4: User Story 2 — Operator class (Priority: P2)

**Goal**: `op(t.data, "jsonb_path_ops")` → `("data" jsonb_path_ops)`; composes with `asc`/`desc`; identifier-validated.

**Independent Test**: contracts/sql.md opclass lines; `op(t.x, "bad-class")` throws `invalid-sql-name`; `("data" jsonb_path_ops desc nulls last)` ordering.

### Tests for User Story 2 (write first, see them fail)

- [x] T020 [P] [US2] Unit: `op()` on a ref, on `desc(...)`, and `desc(op(...))` all yield `{ name, desc, nulls, opclass }`; invalid class → `invalid-sql-name` ("operator class"); — packages/core/test/dsl/index-builder.test.ts
- [x] T021 [P] [US2] Unit: `serializeIndexColumn` writes `opclass` only when set — packages/core/test/table-kind-diff.test.ts
- [x] T022 [P] [US2] Unit: `indexColumnSql` ordering `"col" <opclass> desc nulls first`; opclass change → drop + create — packages/core/test/table-kind-emit.test.ts
- [x] T023 [US2] Golden: add the `jsonb_path_ops` / `gin_trgm_ops` lines and a step-1 opclass change to `table-index-methods`; re-record and review (step-1 redefined as a pure opclass change on `docs_data_idx`, matching contracts/sql.md's own step-1 shape, replacing US1's method-change step — that behaviour stays unit-tested in table-kind-emit.test.ts)

### Implementation for User Story 2

- [x] T024 [US2] `op(input, opclass)` wrapper; widen `asc`/`desc` to accept `IndexColumn`; `IndexColumn.opclass`; `toDeclarationColumn` carries it — packages/core/src/dsl/index-builder.ts (export `op` from packages/core/src/index.ts)
- [x] T025 [US2] `serializeIndexColumn` opclass compact field — packages/core/src/kinds/table-kind.ts
- [x] T026 [US2] `indexColumnSql` opclass token between column and desc — packages/core/src/kinds/table-kind-emit-sql.ts
- [x] T027 [US2] `rewriteIndexesForRename` keeps `opclass` on renamed entries (add to the existing "keeps desc/nulls on the renamed entry" test) — packages/core/test/rename-plan.test.ts, packages/core/src/engine/rename-plan.ts (rename-plan.ts already spread the whole column object — no code change needed, only the test)

**Checkpoint**: US1 + US2 green

---

## Phase 5: User Story 3 — Expression indexes (Priority: P3)

**Goal**: `index("users_email_lower_idx").on(sql\`lower(${t.email})\`)`; stored as a node; validated like partial predicates; retargeted on `--rename`; explicit name required.

**Independent Test**: contracts/sql.md expression lines + step-2 rename; the three `index-expression-*` codes; `rename-plan.test.ts` "renaming a column inside an index expression retargets it with no leftover diff".

### Tests for User Story 3 (write first, see them fail)

- [x] T030 [P] [US3] Unit: `.on(sql\`…\`)` yields an `{ expression }` entry; `op(sql\`…\`, "c")` and `desc(sql\`…\`)` compose — packages/core/test/dsl/index-builder.test.ts
- [x] T031 [P] [US3] Unit (`table()`): unnamed expression index → `index-expression-requires-name` with the proposed name (`users_email_idx` for `lower(t.email)`, `users_expr_idx` for `sql\`now()\``); subquery → `index-expression-subquery`; foreign column → `index-expression-foreign-column-ref`; `unknown-index-column` ignores expression entries; duplicate-name check ignores expression entries — packages/core/test/table-surface.test.ts
- [x] T032 [P] [US3] Unit: serialize writes `expression` as `encodeExprNode` output (D57 vocabulary) and round-trips through `decodeExprNode` — packages/core/test/table-kind-diff.test.ts
- [x] T033 [P] [US3] Unit: emit renders `(lower("app"."users"."email"))`, composes with unique + where; expression change → drop + create — packages/core/test/table-kind-emit.test.ts (F7: renders `((lower(...)))` — always its own extra parens, not just the list's — see contracts/sql.md; also covers a non-function-call operator expression)
- [x] T034 [P] [US3] Unit: column rename inside an index expression retargets the node (`retargetTableFields`), keeps the explicit name, produces drop + create and **no** `ambiguous-column-rename`; table rename retargets too; `rewriteIndexesForRename` skips expression entries for name derivation — packages/core/test/rename-plan.test.ts (spec corrected: rename only, no drop + create — see spec.md Clarifications 2026-08-22 (implementation))
- [x] T035 [US3] Golden: add `users` table expression lines + step-1 expression change + step-2 `--rename app.users.email=email_address` to `table-index-methods`; re-record and review against contracts/sql.md (spec corrected: rename only, no drop + create — see spec.md Clarifications 2026-08-22 (implementation))

### Implementation for User Story 3

- [x] T036 [US3] `IndexColumnInput` / `IndexColumn.column` widened to `Expr`; `toDeclarationColumn` expression branch — packages/core/src/dsl/index-builder.ts
- [x] T037 [US3] `validateIndexExpressions` (three codes, proposal via `collectColumnRefs` + `deriveIndexName`), `unknown-index-column` name-only, duplicate derivation name-only — packages/core/src/dsl/table.ts
- [x] T038 [US3] `serializeIndexColumn` expression branch (`encodeExprNode`) — packages/core/src/kinds/table-kind.ts
- [x] T039 [US3] `indexColumnSql` expression branch (accessor-mediated via `indexColumnExpression`, not a direct `renderExpr(decodeExprNode(...))` call — table-kind-emit-sql.ts never imports the expression codec, matching `whereClause`'s existing convention; researcher-corrected from this task's original wording) — packages/core/src/kinds/table-kind-emit-sql.ts
- [x] T040 [US3] Rename plumbing: `retargetTableFields` + `applyRetargetedIndexColumns`; `rewriteIndexesForRename` name-entries-only; reference list / ambiguity detection includes index-column expressions — packages/core/src/engine/rename-plan.ts

**Checkpoint**: all three stories green; `pnpm check:crap` 0 over 5

---

## Phase 6: Round-trip & example

- [x] T050 `examples/postgres`: new `src/steps/step-8.schema.ts` + `src/app.schema.ts` adding a GIN `jsonb_path_ops` index on a `jsonb` column and `index("…_email_lower_idx").on(sql\`lower(${t.email})\`)` (built-ins only); generate `migrations/0008_*.sql`, update `hejbro.snapshot.json`, extend `test/chain.test.ts` — examples/postgres/**
- [x] T051 `pnpm build` then `cd examples/postgres && pnpm roundtrip` on `postgres:17-alpine` — two-path `pg_dump` identical; paste the tail in the PR

---

## Phase 7: Polish & Before-Claiming-Done

- [ ] T060 [P] Docs: new docs/guide/indexes.md (method list, opclass, expressions + name rule, extension note, alter = drop + create); rewrite `## Indexes` in skills/hejbro/references/dsl-cheatsheet.md; README.md examples/postgres feature line; fix the stale expression-retargeting paragraph in docs/guide/renames.md (line ~92)
- [ ] T061 [P] Decision log: write D84, D85, D86 rows (text from spec.md "Proposes") into docs/specs/2026-08-19-hejbro-design.md §3
- [ ] T062 [P] `.changeset/phase10-index-completeness.md` — `patch` for the three fixed packages (D83), one user-facing paragraph
- [ ] T063 Roadmap: docs/plans/2026-08-22-0.2.0-roadmap.md frontier line + pilot verdict paragraph (ceremony cost, override quality, what to change)
- [ ] T064 `pnpm check && pnpm check-types && pnpm test` — paste output in the PR
- [ ] T065 `pnpm check:crap` — README CRAP block refreshed, 0 functions over 5
- [ ] T066 `/speckit-analyze` clean; `/speckit-converge` reports Converged (or its appended tasks are done)
- [ ] T067 PR to `dev`: `Closes #284`, link to `specs/001-index-completeness/`, commit list; after squash merge `issue.sh close 284`

---

## Dependencies & Execution Order

- Setup → Foundational (T002–T007) → US1 (T010–T017) → US2 (T020–T027) → US3 (T030–T040) → Round-trip (T050–T051) → Polish.
- US2 and US3 both depend on US1's `createIndexBuilder` signature and golden case; US3 additionally depends on US2 only for the `op(expression, class)` composition test (T030) — otherwise US2 ∥ US3 is possible with separate worktrees if the golden case is split into two cases (not recommended for the pilot; keep one case, sequential).
- Within each story: tests (`[P]`) in parallel → implementation in file order (builder → table → snapshot → emit → rename) → golden re-record last.

## Parallel Opportunities

- T004/T005 ∥ T002/T003; T010–T012 ∥; T020–T022 ∥; T030–T034 ∥; T060–T062 ∥.

## Implementation Strategy

- MVP = Foundational + US1 (ships `using` alone if needed).
- One implementer per story is possible after Foundational; reviewer gates each story's commit; the pilot keeps one PR.

## Notes

- Golden `table-indexes` and every other `expected/*` must stay byte-identical throughout (SC-004).
- Never hand-edit `expected/`; re-record with `UPDATE_GOLDEN=1` and read the diff.
- `btree` never appears in a snapshot or in SQL.
