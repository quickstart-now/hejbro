# Tasks: projection-declared-types

One group — a single type utility and its exports. Estimates are pure
work minutes (D88).

## 1. Recover the declared column through the origin brand

- [x] 1.1 (~8m) [design] `OriginColumn` + `ProjectedColumnResult` in
      `select-result.ts`, replacing the family-only fallback for
      declared-column references. The [design] part is which link to
      read: the `columnOriginBrand` `TableColumns` already stamps
      (`{columns, key}`) rather than adding a new one to `ColumnRef`,
      which is what #311's title proposed — the brand is already there,
      already carries exactly the declaring column, and is already how
      `.references()` resolves its edge. Red:
      `packages/query/test/types/select-result.test.ts` — "a projected
      table column keeps its declared type". Files:
      `packages/query/src/types/select-result.ts`,
      `packages/core/src/index.ts`, that test.
- [x] 1.2 (~5m) Pin the two axes that deliberately do NOT move: a
      non-column expression still resolves to its family, and a
      `notNull` column's projected field stays nullable (#307). Red:
      same file — both assertions fail if the brand arm over-reaches.
      Files: that test only.
- [x] 1.3 (~6m) Runtime soundness witness: an object projection's
      `ColumnRefNode` converts by its declared column state, so the
      narrowed type describes what actually arrives. Red:
      `packages/query/test/db/convert.test.ts` — "an object projection
      converts by the declared column too". Files: that test only.
- [x] 1.4 (~6m) The two `execute-result-type.test.ts` assertions that
      pinned the old widened union, and the query-layer reference's
      inference paragraph. Changeset (D59, `minor` — a capability the
      surface did not have). Files: that test,
      `skills/hejbro/references/query-layer.md`, `.changeset/*.md`,
      `openspec/task-times.csv`, `README.md`.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` unchanged (this is a type utility; no branches).
- The soundness argument is a test, not a claim: 1.3 fails if the
  conversion path ever stops resolving a projected column's declared
  state, which is the only thing that makes 1.1's narrowing honest.
