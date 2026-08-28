# Tasks: add-offset-and-distinct

One group: the node fields, their rendering, their codec entries and the
format bump are a single edit — the tree does not type-check between any
two of them. Estimates are pure work minutes (D88).

## 1. Pagination and de-duplication

- [x] 1.1 (~9m) [design] `SelectNode.offset` + `DistinctNode` +
      `SetOpNode.offset`, the renderer clauses, and the codec's
      encode/decode. The [design] part is the chain shape: `offset`
      after `limit` AND standalone (a bare `offset` is legal SQL);
      `distinct` only on the stage `select` returns, so SQL's own
      placement is the only one expressible. Red:
      `packages/core/test/query/select.test.ts` — "renders offset after
      limit", "renders distinct and distinct on". Files:
      `packages/core/src/expr/{ast,render-sql,codec}.ts`,
      `packages/core/src/query/select.ts`, that test.
- [x] 1.2 (~6m) One shared row-count validator for `limit` and `offset`
      (`invalid-limit`/`invalid-offset`), so the two cannot drift on
      what they accept. Red: same file — "rejects a negative or
      fractional offset", "rejects distinct on with no columns". Files:
      `packages/core/src/query/select.ts`, that test.
- [x] 1.3 (~7m) The chain surface mirrors it, including the
      `limit().offset()` pair and the distinctable entry stage. Red:
      `packages/query/test/compile/select.test.ts` — "paginates with
      limit and offset, both rendered inline". Files:
      `packages/query/src/db/chain.ts`, `packages/core/src/index.ts`
      (exports), that test.
- [x] 1.4 (~10m) Snapshot format 8: the constant, its diagnostics'
      expectations, 15 goldens, and both examples' committed chains
      (snapshot + every migration's two banner hash lines — regenerated
      by replaying each chain, not hand-edited). Red: the golden suite
      and both example chain tests. Files:
      `packages/core/src/snapshot/snapshot.ts`, the version assertions,
      `examples/*/hejbro.snapshot.json`, `examples/*/migrations/*.sql`,
      `packages/core/test/golden/cases/*/expected/snapshot.json`.
- [x] 1.5 (~7m) The reason the bump exists, as a test: a view body
      carrying `distinct on` + `limit` + `offset` round-trips through a
      real snapshot and diffs to nothing. Red:
      `packages/core/test/view-kind.test.ts`. Files: that test.
- [x] 1.6 (~8m) Live witness against postgres:17 — the server takes the
      page, and `distinct on` returns the row the ordering puts first
      per group. Verified load-bearing by asserting the pre-ordering row
      instead (real server returned `['a2','b3','c9']`, the assertion
      `['a1','b1','c9']` failed). Files:
      `packages/pg/test/integration.test.ts`.
- [x] 1.7 (~6m) `skills/hejbro/references/query-layer.md` gains both, with
      the `distinct on` + `order by` pairing stated. Changeset (D59,
      `minor`), task times, README badges. Files: that reference,
      `.changeset/*.md`, `openspec/task-times.csv`, `README.md`.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` clean.
- `pnpm --filter @hejbro/pg test:integration` 6/6 live against a real
  postgres:17, including the new witness.
