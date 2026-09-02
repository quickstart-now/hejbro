# Tasks: curate-hejbro-barrel (#471)

Lead-direct piece (cli package only). Base: dev `a45a3a24`. Estimates at
agent scale.

## 1. The two lists, the barrel, and the pins (#471)
Files: `packages/cli/src/core-surface.ts` (new), `packages/cli/src/index.ts`,
`packages/cli/test/exports.test.ts`, `skills/hejbro/SKILL.md`,
`.changeset/*.md`, `openspec/task-times.csv`

- [x] 1.1 (~8m) [design] `core-surface.ts`: `VOCABULARY` and `ENGINE` as
      two `as const` sorted arrays, 107 + 97 names, each with a one-line
      group comment (declarations / types / expressions / aggregates and
      windows / query / utilities; engine: render, codec, diff and
      generate, kinds and registry, banner and snapshot, traversal, brands
      and helpers). Settled: `leftJoinedBrand` is vocabulary (a shipped
      spec names it as reaching users); the three banner readers
      (`parseBannerHashes`/`parseBannerVersion`/`parseBannerBaseline`) are
      vocabulary — the skill's generate/verify reference documents them
      as `hejbro` exports for reading a banner; `hejbroError`/
      `throwHejbroError` are engine (preset authors import from core),
      `HejbroError` is vocabulary. Failing test: `exports.test.ts` — "every runtime export
      of @hejbro/core is classified exactly once" (union equals
      `Object.keys(core)` filtered to runtime values; intersection empty;
      failure message names the offenders).
- [x] 1.2 (~9m) `index.ts`: `export type * from "@hejbro/core"` plus an
      explicit `export { … } from "@hejbro/core"` of the vocabulary. The
      explicit list SHALL equal `VOCABULARY` — pinned by a test that
      compares the barrel's core-sourced runtime keys to the list.
      Measured: `examples/{postgres,supabase}/test/*.test.ts` import
      `checkChain`, `createDefaultRegistry`, `emptySnapshot`,
      `generateMigration`, `registerPresets`, `renderSnapshot` from
      `hejbro` — those are engine, and the tests move them to
      `@hejbro/core` (the examples' own dependency list gains it if it is
      not there; they are private packages). The skill's snippets import
      only vocabulary (the banner readers, now classified as such).
      Failing tests:
      "renderExpr is not exported from hejbro" (`@ts-expect-error` on the
      value import + `"renderExpr" in hejbro` false), "leftJoinedBrand
      still is", and the exact-set pin "hejbro's runtime exports are
      exactly this sorted list" (neon `entry.test.ts` shape). Mutant:
      re-add `export *` — the pin and the renderExpr test go red.
- [x] 1.3 (~4m) SKILL.md one sentence (engine helpers such as
      `generateMigration` come from `@hejbro/core`, not `hejbro`); `minor`
      changeset naming the 101 names' new home; ledger row. Failing test:
      `packages/skills/test` token assertion only if one exists for
      SKILL.md (measure); otherwise covered by 1.2.

## Verification (definition of done, not a task)
`openspec validate curate-hejbro-barrel --strict`; `openspec show
curate-hejbro-barrel --diff`; `TURBO_FORCE=1 pnpm check / check-types /
test / check:bans / check:crap`; `pnpm build --force` then the cli
subprocess suites and `examples/*` chain tests (they import `hejbro`);
no file under `packages/{core,query,supabase,neon,nile,pg}` in the diff.
