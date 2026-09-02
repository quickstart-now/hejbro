# Tasks: fix-mutation-result-type (#622)

Lead-direct piece (types only; no SQL or runtime change). Base: dev
`a45a3a24`. Estimates at agent scale.

## 1. The never-requested marker and the types that read it (#622)
Files: `packages/core/src/query/mutate.ts`, `packages/query/src/types/
returning.ts`, `packages/query/src/db/db.ts`, `packages/query/src/db/
chain.ts`, `packages/query/test/db/execute-result-type.test.ts`,
`packages/query/test/types/chain-types.test.ts`, `packages/core/test/
exports.test.ts` / `packages/query/test/exports.test.ts` (only if the
marker is exported), `skills/hejbro/references/*.md`, `.changeset/*.md`,
`openspec/task-times.csv`

- [x] 1.1 (~8m) [design] The marker: a distinct type for "returning was
      never requested", used as the default of every mutation stage's
      `TReturning` in core's `mutate.ts`, while `returning()`'s
      no-argument form keeps `undefined`. Settle whether the marker is
      exported (decides the exact-set export pins) and its name.
      Failing test: `execute-result-type.test.ts` — "an insert that never
      called returning() resolves ReadonlyArray<never>" (`expectTypeOf`
      exact; plus a `@ts-expect-error` on reading a column off an
      element). Green stays green for "returning() with no projection
      resolves every declared column" (existing test, cite).
- [x] 1.2 (~7m) `ReturningRow` maps the marker to `never`;
      `ExecuteResult` and the `*ChainFinal` types default to the marker
      so the chain surface and `db.execute` agree. Failing test:
      `chain-types.test.ts` — "a mutation chain awaited without
      returning() types as ReadonlyArray<never>"; "update()/deleteFrom()
      resolve through the same mechanism" (extend the existing shared-path
      test with the never case). Mutant: point the default back at
      `undefined` — exactly the new tests go red.
- [x] 1.3 (~5m) The skill's mutation-result sentence, the doc comments in
      `db.ts`/`chain.ts` that call this a "known, documented imprecision"
      (they now describe a precision, or go), `minor` changeset naming
      the compile-time break, ledger row. Failing test:
      `packages/skills/test/*` token assertion if the skill has one for
      the query reference (measure first); otherwise none beyond 1.1/1.2.

## Verification (definition of done, not a task)
`openspec validate fix-mutation-result-type --strict`; `openspec show
fix-mutation-result-type --diff` with zero "No matching main requirement"
warnings; `TURBO_FORCE=1 pnpm check / check-types / test / check:bans /
check:crap`; the rendered SQL of a mutation without `returning` is
byte-identical before and after (existing compile tests stay green).
