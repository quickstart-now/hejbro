# Tasks: fix-vendoring-compat

One group, one team (`vc`). Estimates are pure work minutes. Every task
starts from its named red test. Verification (gates, `openspec validate
--strict`, `show --diff`) is the definition of done, never a task.

## 1. Vendoring compatibility (#676)

- [ ] 1.1 (~9m) `[design]` The export reader accepts a format-1
      description whose function facts carry no `args`/`returns`
      (#657). Red: `packages/cli/test/validate-export.test.ts` —
      "reads a pre-functions export and carries its tables" with a
      **hand-written** pre-#587 `schema.json` literal (never one this
      writer produced). Green: `functionFactSchema` makes `args` and
      `returns` optional on read; a fact missing either reads as
      "present, untyped". `packages/cli/src/contract/functions.ts`
      skips such a function (no `Functions` entry, no client metadata).
      Design detail settled here: the read shape of an untyped function
      fact (`args: null`/`returns: null` vs. absent) — pick one, state it
      in the delta scenario's THEN if it becomes observable.
      Files: `packages/cli/src/vendor/validate-export.ts`,
      `packages/cli/src/contract/functions.ts`, tests.
- [x] 1.2 (~6m) `createNameKeyedDb` accepts metadata with no
      `functions` member (#659). Red:
      `packages/query/test/client/legacy-metadata.test.ts` — "a
      contract vendored before functions builds a client with an empty
      fn" (hand-written metadata literal, no `functions` key, passed as
      the real call argument). Green: `functions` optional in
      `ContractMetadata`, read with `?? {}`.
      Files: `packages/query/src/client/contract-types.ts`,
      `packages/query/src/client/name-keyed-db.ts`, test.
- [ ] 1.3 (~8m) `[design]` Bare `insert()`/`update()`/`delete()` type
      as resolving to no rows (#654). Red:
      `packages/query/test/client/mutation-result.test.ts` — runtime:
      `await client.posts.insert(row)` resolves to `[]` with no
      `RETURNING` in the recorded SQL; type: assigning the result to
      `ReadonlyArray<Row>` is a compile error (`@ts-expect-error`,
      the package's own idiom). Green: `NameKeyedTableClient.insert`
      returns `Promise<ReadonlyArray<never>>`;
      `NameKeyedMutationChain<TRow>` resolves `ReadonlyArray<never>`
      until a `.returning()` exists (it does not — #653 territory).
      Remove the `as unknown as` casts that let the type diverge.
      Files: `packages/query/src/client/name-keyed-db.ts`, test,
      `skills/hejbro/references/polyrepo.md` (one sentence).
- [x] 1.4 (~6m) Non-identifier keys are quoted in the emitted contract
      (#662). Measured: D36 validates a column's final SQL name
      (`^[a-z][a-z0-9_]*$`), and every key surviving it is already a
      valid TS identifier — so a non-identifier **column** key cannot be
      declared through the DSL at all; a function argument key can (core
      checks reserved words only). Red, per the lead's ruling: the
      argument key rides the real DSL into the `examples/cli-smoke`
      real-`tsc` fixture, and the column key enters through the
      emitter's other input contract — a hand-written export table fact
      (`schema.json` is a committed, hand-editable file, and the reader
      never checks key shape) — in
      `packages/cli/test/contract-emit.test.ts`, "quotes a column key
      and an argument key that are not identifiers". Green: one
      `renderKey`
      helper shared by `contract/tables.ts` and `contract/functions.ts`.
      Files: `packages/cli/src/contract/{tables,functions}.ts`, tests,
      `examples/cli-smoke/test/*`.
- [ ] 1.5 (~7m) `interval` compiles in a vendored contract (#661). Red:
      `examples/cli-smoke` real-`tsc` fixture with an `interval` column
      and an `interval` function argument (currently `IntervalValue`
      unresolved). Green: `GENERATED_HEADER`/`renderHeader` imports the
      value type from `hejbro` (measure the export name first;
      `packages/cli/src/index.ts` must expose it) — or inline the
      shape if it is not exported. Close: `.changeset/fix-vendoring-compat.md`
      (`patch`), `skills/hejbro/references/query-layer.md` sentence on
      older exports still reading.
      Files: `packages/cli/src/contract/{ts-type,emit}.ts`,
      `examples/cli-smoke/test/*`, changeset, skill.

Group close: `openspec validate fix-vendoring-compat --strict`,
`show --diff` 0 warnings (and the two MODIFIED requirements classified
MODIFIED, not ADDED), full CI-derived gate sweep, `pnpm build --force`
before the cli subprocess suites. Ledger rows and README badges are the
lead's PR-time commit.
