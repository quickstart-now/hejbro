# Tasks: fix-nile-findings

Change issue: #750. Group 1 tracks as #754, group 2 as #755. One team runs
the groups in order (group 2 uses group 1's exported entry point). Group 2's
reviewer runs in constructor mode: its input (the catalog's `pg_get_expr`
text) is foreign to hejbro's own output (D110).

Definition of done for every task: `pnpm check`, `pnpm check-types`,
`pnpm test` green (`TURBO_FORCE=1` in this worktree); the delta scenarios
of `openspec show fix-nile-findings --diff` hold.

## 1. Table-bound column references render by table and column (#754)

- [x] 1.1 [design] ~9m — Red: `packages/core/test/expr/render-table-bound.test.ts`
  (new) with an input table spanning the requirement: a top-level ref; a ref
  inside a `sql` template chunk; a ref inside `exists(...)` to the outer table
  and to the subquery's own table (both two-part, the `from` target three-part);
  a subquery whose `from` names a same-bare-name table under another schema
  (both refs three-part); a CTE column ref (unchanged); and the same nodes
  through plain `renderExpr` (three-part, unchanged). Green: a scope marker
  beside `DeclaredCteMarker`, the column-reference arm reading it, exported
  `renderTableBoundExpr(node, outerScope?)`.
  Files: `packages/core/src/expr/render-sql.ts`, `packages/core/src/index.ts`,
  the new test.
- [x] 1.2 ~8m — Red: the four expectations in
  `packages/core/test/table-kind-emit.test.ts` that pin a check, an
  `alter table … add constraint … check`, a partial-index predicate and an
  expression index (lines ~649/681/717/887) rewritten to the two-part form,
  plus `packages/core/test/generated-columns.test.ts`'s interpolated-sibling
  case. Green: `checkExpression`, `indexWhere`, `indexColumnExpression`,
  `columnGenerated` render through the table-bound entry;
  `column-order.ts`'s declared-side render uses the same entry so the
  rebuild comparison stays like-for-like.
  Files: `packages/core/src/kinds/table-snapshot.ts`,
  `packages/core/src/snapshot/column-order.ts`, the two tests.
- [x] 1.3 ~7m — Red: `packages/core/test/policy-kind.test.ts`'s top-level
  (`using ("posts"."published_at" is not null)`), `with check`, and
  correlated-`exists` expectations rewritten to the delta scenario's text;
  `packages/core/test/not-null-elements.test.ts`'s
  `array_position("posts"."tags", null) is null`. Green: `policyUsing`/
  `policyWithCheck` render through the table-bound entry with the policy's
  table still in the outer scope.
  Files: `packages/core/src/kinds/policy-kind.ts`, the two tests.
- [x] 1.4 ~9m — Red: `examples/postgres/test/chain.test.ts` and
  `examples/supabase/test/chain.test.ts` (committed migration text vs
  regenerated), `packages/core/test/golden` cases whose `expected/` carry a
  check, partial index, expression index or policy, and any
  `packages/{supabase,neon,nile}/test` expectation pinning a table-bound
  rendering (`packages/supabase/test/auth.test.ts`,
  `packages/neon/test/auth.test.ts`). Green: regenerate the example chains
  step by step (the chain test's own procedure), update the goldens, and
  confirm `hejbro.snapshot.json` in both examples is byte-identical.
  Files: `examples/*/migrations/*.sql`, `packages/core/test/golden/cases/*/expected/*`,
  the listed tests.
- [x] 1.5 ~6m — Red: `packages/skills/test` (or the skill's own check) is
  not applicable; the red test here is the delta scenario "A view body is
  unchanged" pinned in `packages/core/test/view-kind.test.ts` (an existing
  three-part expectation that must stay green). Green: one sentence in
  `skills/hejbro/references/dsl-cheatsheet.md` (table-bound column
  references render `"table"."column"`), one in
  `skills/hejbro/references/nile-preset.md` (tenant-aware tables and the
  schema-name limit), and `.changeset/fix-nile-findings.md` (`patch`).
  Files: the two references, the changeset.

## 2. `check` compares by text where the preset says the server cannot plan (#755)

- [x] 2.1 [design] ~6m — Red: `packages/nile/test/preset.test.ts` "declares
  explainUnavailable" and `packages/core/test/engine/preset.test.ts` (or
  the nearest existing preset-shape test) "a preset without the field is a
  Preset". Green: `Preset.explainUnavailable?: true` in
  `packages/core/src/engine/preset.ts`; `nilePreset` carries it.
  Files: `packages/core/src/engine/preset.ts`, `packages/nile/src/preset.ts`,
  the two tests.
- [x] 2.2 [design] ~9m — Red: `packages/cli/test/check-expression.test.ts`
  new describe "3.5 text comparison" with an input table: equal after each
  normalization step alone (whitespace; one enclosing paren pair; two-part
  and three-part table qualifier; quoted vs unquoted plain identifier;
  `'x'::text` vs `'x'`), equal after all of them together, an inner paren
  difference that must stay unequal, `"Name"` vs `"name"` that must stay
  unequal, and the `in (...)` vs `= ANY (ARRAY[...])` case → not compared
  with both texts, a `Next:` naming the restatement and no `EXPLAIN` word.
  Green: `compareCheckConstraint(..., mode)` with `"server"` unchanged and
  `"text"` normalizing both sides; the not-compared reason and `Next:` for
  the text mode.
  Files: `packages/cli/src/check/expression.ts`, the test.
- [x] 2.3 ~8m — Red: `packages/cli/test/check-command.test.ts` with a fake
  preset declaring `explainUnavailable`: the run never issues an `explain`
  statement, the coverage boundary carries the text-comparison line, and a
  config without the declaration issues `explain` exactly as before.
  Green: `check.ts` derives the mode from `config.presets`, threads it to
  `compareCheckConstraint`, and appends the boundary line for the run.
  Files: `packages/cli/src/commands/check.ts`, the test.
- [ ] 2.4 ~7m — Red: `packages/cli/test/check-live.integration.test.ts`
  (Docker) with a fake `explainUnavailable` preset against real Postgres:
  the reporter's `length(btrim(name)) > 0` constraint agrees, an `in (...)`
  constraint is not compared, and exit codes follow. Green: nothing beyond
  2.1–2.3 unless the witness finds a normalization gap.
  Files: the integration test.
- [ ] 2.5 ~6m — Red: none runnable (documentation); the definition of done
  is `openspec validate fix-nile-findings --strict` green. Green:
  `skills/hejbro/references/nile-preset.md` "check on Nile" paragraph
  (what agrees, what is reported as not compared, the restatement advice),
  `skills/hejbro/references/brownfield-adoption.md` exit-2 row extended,
  and the file-a-follow-up for view/query references on Nile
  tenant-aware tables (sub-issue of #412).
  Files: the two references.
