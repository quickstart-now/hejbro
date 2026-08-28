# Tasks: add-set-operations

Groups are parallel-safe slices (no file overlap). Group 2 starts
after group 1 (it builds the node group 1 defines); group 3 after 1–2;
group 4 after 1–3. Estimates are pure work minutes (D88).

## 1. The SetOpNode and its core propagation

- [ ] 1.1 (~8m) [design] `SetOpNode` variant on `QueryNode` (field
      names + kebab discriminators settled here: `queryKind:
      "setOp"`/snapshot `"set-op"`, `operator` values verbatim SQL
      keywords). Red: `packages/core/test/query/select.test.ts` — "a
      set-op node renders the two branches joined by the operator"
      (drives the node + renderer together). Files:
      `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.2 (~8m) [design] Renderer completion: nested branches
      parenthesized, `all` keyword, whole-set `order by`/`limit`
      after the last branch, orderBy scope = left branch (golden
      settles the exact text). Red: same test file — "nesting
      parenthesizes and whole-set order/limit trail the set". Files:
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.3 (~8m) Codec: encode/decode entries for the new queryKind
      (kebab map + round-trip), and the callers that REQUIRE a plain
      select (plpgsql select-into path, decode guard) reject a set-op
      loudly. Red: `packages/core/test/expr/codec.test.ts` — "a set-op
      statement survives encode/decode". Files:
      `packages/core/src/expr/codec.ts`, that test.
- [ ] 1.4 (~6m) Walk/retarget/scope arms + `reachable-kinds`/naming
      fixture producer (a view carrying a union) so the D70
      completeness assertion sees the new vocabulary. Red:
      `packages/core/test/naming-conventions.test.ts` completeness
      (goes red the moment the discriminator exists unproduced).
      Files: `packages/core/src/expr/{walk,retarget}.ts`,
      `packages/core/test/expr/reachable-kinds.ts`,
      `packages/core/test/naming-conventions.test.ts`.

## 2. Core builder, views, column order — after group 1

- [ ] 2.1 (~8m) The six combinators on the core select stages + the
      post-combination `SetOpStage` (`orderBy`/`limit`). Red:
      `packages/core/test/query/select.test.ts` — "union/unionAll/
      intersect/except combinators build the recursive node". Files:
      `packages/core/src/query/select.ts`, that test,
      `packages/core/src/index.ts` (exports).
- [ ] 2.2 (~8m) Views: `defineView` accepts a set-op stage,
      `view-kind` serializes it, `projectionColumns` resolves the
      LEFT branch, D81 column-order oracle likewise. Red:
      `packages/core/test/view-lifecycle` golden (or view-kind test) —
      "a union view round-trips and lists the left branch's columns".
      Files: `packages/core/src/dsl/define-view.ts`,
      `packages/core/src/kinds/view-kind.ts`,
      `packages/core/src/snapshot/column-order.ts`, tests.

## 3. Query layer — after groups 1–2

- [ ] 3.1 (~6m) Compile handlers + `columnPlanForStatement` (left
      branch) + `CompileInput` acceptance. Red:
      `packages/query/test/compile/` — "a set-op statement compiles
      with lifted params from both branches". Files:
      `packages/query/src/compile/{compile,params}.ts`, that test.
- [ ] 3.2 (~8m) [design] `SetOpResult` typing (key-set gate, left
      keys, per-key union, nullability OR — exact rejection shape
      settled here, the `related()` never-poison precedent). Red:
      `packages/query/test/types/set-op.test.ts` — "identical shapes
      pass through; mismatched keys fail to type-check; nullability
      widens". Files: a new `packages/query/src/types/set-op.ts`,
      that test.
- [ ] 3.3 (~8m) Chain combinators + thenable set-op stage wired
      through `ChainApi` (both ladders), `compile()` parity with the
      core builder. Red: `packages/query/test/db/set-op.test.ts` —
      "chain union compiles byte-identically to the core builder
      formulation and resolves converted rows". Files:
      `packages/query/src/db/chain.ts`, that test.

## 4. Real-server witness — after groups 1–3

- [ ] 4.1 (~8m) Docker PG17: union/unionAll/except live — converted
      arrivals (bigint/interval per the left branch), dedup vs `all`
      row counts, whole-set order/limit, and one RLS-scoped set-op
      (one statement under the context). Red: extend
      `packages/pg/test/integration.test.ts`. Files: that file only.
- [ ] 4.0 (docs, with the archive PR) `skills/hejbro` query-layer
      reference gains the set-operations section (compiled snippets;
      the "not supported" line shrinks) — archive-PR timing per the
      relational-reads precedent.
