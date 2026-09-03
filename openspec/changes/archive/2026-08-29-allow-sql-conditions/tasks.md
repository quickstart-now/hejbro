# Tasks: allow-sql-conditions

Groups are parallel-safe slices (no file overlap). Group 2 starts after
group 1 (it consumes the type group 1 exports); group 3 after 1-2.
Estimates are pure work minutes (D88).

## 1. The Condition union in core

- [x] 1.1 (~8m) [design] Export `Condition` (`Expr<"boolean"> |
      Expr<"unknown">`) from core's expression module and apply it to
      the select stage's `where` and to `innerJoin`/`leftJoin`'s `on`
      (interface + the join helper's own parameter). The [design] part
      is the name and its home: `Condition` in `expr/ast.ts` beside
      `Expr`, exported from the barrel, carrying the D50/D51/#113
      lineage note. Red: `packages/core/test/query/select.test.ts` —
      "a sql fragment is accepted as a where condition and renders
      inside the compiled statement". Files:
      `packages/core/src/expr/ast.ts`,
      `packages/core/src/query/select.ts`,
      `packages/core/src/expr/operators.ts`,
      `packages/core/src/index.ts`, that test.
- [x] 1.2 (~6m) Update and delete `where` (both the stage interfaces
      and the two builder implementations) accept `Condition`. Red:
      `packages/core/test/query/mutate.test.ts` — "a sql fragment
      filters an update and a delete". Files:
      `packages/core/src/query/mutate.ts`, that test.

## 2. The chain surface - after group 1

- [x] 2.1 (~8m) Every chain condition position takes `Condition`:
      select `where`, `innerJoin`/`leftJoin` `on`, update `where`,
      delete `where`, and the `related()` chain's `where`. Red:
      `packages/query/test/types/chain-types.test.ts` — "a sql
      fragment type-checks in every chain condition position" (the
      type-level assertion is the test: today each position rejects
      it). Files: `packages/query/src/db/chain.ts`, that test.
- [x] 2.2 (~7m) Compile witness: a fragment condition carries its
      interpolations as bind parameters in the statement's condition
      slot, and composes with an operator-built condition through
      `and` in written order. Red: `packages/query/test/compile/`
      (select + update) — "a sql condition parameterizes and composes".
      Files: that test only.

## 3. Documentation - after groups 1-2

- [x] 3.1 (~6m) `skills/hejbro/references/query-layer.md`: replace the
      "a `sql` fragment does not type-check there (tracked as #386)"
      paragraph (lines ~195-208) with the accepted-everywhere rule, and
      correct the code-coordinates entry that cites
      `select.ts` as requiring `Expr<"boolean">` and `check.ts` as the
      declaration-side *contrast* (they now agree). Verify the "Not
      supported in this version" list needs no edit (it never carried
      this item). Files: that reference only.
- [x] 3.2 (~5m) Changeset (D59, `patch` - a widening bug fix against an
      already-specified requirement) naming one of the fixed group;
      `openspec/task-times.csv` rows for groups 1-3. Files:
      `.changeset/*.md`, `openspec/task-times.csv`.

## Verification

- `pnpm check` clean (baseline parity: dev has 0 warnings, so the one
  `noUnusedImports` warning the widening left behind in `chain.ts` was
  fixed rather than accepted).
- `pnpm check-types` 13/13, `pnpm test` 14/14 (1,940 tests).
- `pnpm check:crap` 0 of 1309 functions over CRAP 5 — README stamp
  unchanged, correctly: this change adds no branches.
- Red proven by reversion, not by assumption: reverting `chain.ts`'s six
  widened positions turns exactly 6 type assertions red; reverting core's
  leaves the three `select.test.ts` positions (`where`, join `on`, `and`)
  red. The runtime path always carried fragments — every red here is a
  type error, which is the whole defect.
