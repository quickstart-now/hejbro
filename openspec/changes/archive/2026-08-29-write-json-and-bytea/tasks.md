# Tasks: write-json-and-bytea

One group — the literal kinds, their lifts, their two renderers and the
gate are a single edit; the mapped-type handler tables make the tree
refuse to compile between any two of them (which is the point). Estimates
are pure work minutes (D88).

## 1. A declared type is enough to lift a value

- [x] 1.1 (~8m) [design] Two `LiteralNode` kinds — `json` (carrying
      `typeName: "json" | "jsonb"`) and `bytea` — plus their lifts in
      `liftColumnValue`, beside the array and interval lifts that
      already dispatch on the column's `TypeNode`. The [design] part is
      the `typeName` field: without it a `json` column would render
      through a `::jsonb` cast and silently acquire jsonb's key
      reordering and duplicate-stripping. Red:
      `packages/core/test/query/mutate.test.ts` — "renders a json value
      as its serialized text with the declared cast". Files:
      `packages/core/src/expr/ast.ts`,
      `packages/core/src/query/column-value.ts`,
      `packages/core/src/expr/literal.ts`, that test.
- [x] 1.2 (~5m) Open the write gate for the two scalar families, leaving
      arrays of them closed. Red: same file — "accepts a raw JSON value
      and a Uint8Array" (a type-level red: the runtime lifted fine, the
      types refused). Files: `packages/core/src/query/mutate.ts`, that
      test.
- [x] 1.3 (~5m) Both kinds join the codec's non-snapshot set, so the
      existing loud `non-snapshot-literal` failure covers them by
      construction rather than by a new check. Files:
      `packages/core/src/expr/codec.ts`.
- [x] 1.4 (~6m) Bind-parameter handlers: `json` bare (the target column
      decides json vs jsonb — no cast written here could know), `bytea`
      with an explicit `::bytea` for `interval`'s reason. Red:
      `packages/query/test/compile/mutation.test.ts` — "serializes a
      json value and hex-encodes bytes, both as bind parameters" plus an
      adversarial-string case. Files:
      `packages/query/src/compile/params.ts`, that test.
- [x] 1.5 (~6m) The two type tests that pinned the old contract
      (`insert-input`, `chain-mutation-input`) now pin the new one,
      including that the brand narrows writes. Files: those tests.
- [x] 1.6 (~8m) Live witness against postgres:17: a branded `jsonb`, a
      `json` and a `Uint8Array` written and read back equal, plus a
      wholesale jsonb update. Verified load-bearing by changing one
      expected byte (real server returned `[0,255,16,127]`). Files:
      `packages/pg/test/integration.test.ts`.
- [x] 1.7 (~6m) `skills/hejbro/references/query-layer.md`: the
      "`Expr`-only for those three" paragraph replaced, with a
      self-contained compiling example (the first draft used the shared
      prelude, which has no jsonb column — an example that would not
      have shown the feature). Changeset (D59, `minor`), task times,
      README badges.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` clean.
- `pnpm --filter @hejbro/pg test:integration` 7/7 live against a real
  postgres:17.
