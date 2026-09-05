# Tasks: harden-set-op-families

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands in either order with `widen-set-op-execute`
(shared file `query/select.ts`, different regions — rebase, no merge
conflict expected).

**Files edited**: `packages/core/src/query/select.ts`, `packages/core/
src/query/with.ts`, `packages/core/test/query/*set-op*-types.test.ts`
and the recursive-term type test, `packages/core/test/query/
select.test.ts` (1.2a — the one call site the new rule refuses);
`packages/query/src/db/chain.ts`, the new `packages/query/src/db/
chain-projection.ts`, `packages/query/test/types/*.test.ts` (1.2b,
1.2c); `packages/core/src/index.ts` (1.2c); `skills/hejbro/references/
query-layer.md`, one `.changeset/*.md` (1.3). A task that tightens a
type also repairs the existing call sites the new rule refuses; the
repo-wide `check-types` run is that list, and each such file is named
here. If a task appears to need any other file, that goes back to the
planner, not into the diff.

**Ordering.** 1.1 → 1.2a → 1.2b → 1.2c → 1.3.

## 1. Family agreement

- [x] 1.1 (~10m) **[design]** The measured pair table. On a
      `postgres:17` container, for every ordered pair of the ten
      concrete families (`uuid text numeric boolean datetime interval
      json bytea net array`), run one `union` of two typed literals and
      record refused (`42804`) vs unified; also each family against an
      untyped literal (the `"unknown"` wildcard claim). Vendor the
      matrix as a literal in `select.ts` (a `readonly` record keyed by
      family, the constraint stated in one comment line) and the
      reproduction SQL plus server version in design.md. Red: the type
      test's enumeration — every member of `sqlTypeFamilies` except
      `"unknown"` has a row, and the row count equals the matrix size
      (a family added without a row fails). Files: `select.ts`, tests,
      design.md.

- [x] 1.2a (~10m) The rule on the two projection surfaces. Red: an
      input table over {every refused pair from the vendored table →
      `@ts-expect-error` at the combinator's parameter; every accepted
      pair → accepted; `"unknown"` on the left, on the right, on both →
      accepted; same family both sides → unchanged result type; a
      union-typed family (a wide `Expr`) → accepted; a `Table`
      projection's symbol key → accepted} × {core `union`, recursive
      anchor/term}, plus a within-family row (`int` vs `bigint`) that
      stays accepted with a comment pointing at #489/#977, and #966's
      own row (a text anchor against an integer term, one shared key)
      named as such. Green: `SetOpResult` folds the family test over the
      key set; `with.ts` gains nothing but inherits it. Mutation
      (503/R5): removing a family from its own list in the vendored
      table reddens exactly that family's same-family rows and nothing
      else. Files: `select.ts`, `with.ts`, core tests.

- [x] 1.2b (~10m) **[design]** The chain's projection carrier (503/R7,
      503/R9). `SelectChainLimited` and `SelectChainSetOp` gain an
      optional phantom `{ readonly [chainProjectionBrand]?: TProjection }`
      — never assigned at runtime, the `leftJoinedBrand` precedent —
      declared in `@hejbro/query` and exported from its barrel because
      the emitted `.d.ts` names it. A combined stage carries the left
      branch's projection, and the new type parameter defaults so
      one-argument uses keep compiling. Red: the brand-existence row —
      the property is extracted with `infer` and asserted directly,
      never by comparing whole stage types (that passes vacuously,
      `select-join-types.test.ts`'s own measured trap). Files:
      `packages/query/src/db/chain.ts`, the new `packages/query/src/db/
      chain-projection.ts`, `packages/query/src/index.ts`,
      `packages/query/test/types/*.test.ts`.

- [ ] 1.2c (~10m) The rule on the chain surface. Red: 1.2a's input
      table on the chain — a refused pair, an accepted same-family
      pair, `"unknown"` on one side, a union-typed family — plus a
      branch carrying no brand (`related()`'s terminal) that stays
      accepted. Green: the combinators' `other` parameter takes the
      family check beside the existing row-based `CompatibleBranch`,
      never in place of it. Mutation: removing the brand from
      `SelectChainLimited` turns the chain's refusal row green and
      nothing else. Files: `packages/query/src/db/chain.ts`,
      `packages/query/test/types/*.test.ts`, `packages/core/src/query/
      select.ts`, `packages/core/src/index.ts`.

- [ ] 1.3 (~5m) Reference and changeset. `query-layer.md`'s
      set-operation and recursive-CTE sections state the family rule,
      the wildcard and the within-family limit; `pnpm changeset` →
      `minor`. Files: the reference, `.changeset/*.md`.
