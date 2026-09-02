# D106 adversarial spec-only evaluation — curate-hejbro-barrel

**FAIL — 1 blocking, 0 major, 1 minor**

Scope: the `package-surface` delta as rendered by
`openspec show curate-hejbro-barrel --diff`, checked against the public
surface it describes. Everything below was verified by execution unless
marked UNVERIFIED.

---

## B1 (BLOCKING) — the requirement forbids exporting "banner … parsers"; the barrel exports three of them

The delta requirement states:

> The `hejbro` package SHALL export every runtime value a schema author or
> query writer uses from `@hejbro/core` … and **SHALL NOT export core's
> engine: renderers, codecs, the diff and generation machinery, kind
> definitions, banner and snapshot parsers, traversal tables, and internal
> brands and helpers.**

The requirement's only stated exception is the brand:

> The one brand another shipped requirement names as reaching users through
> `hejbro` (`leftJoinedBrand`) stays exported.

There is no exception for the banner parsers, and no scenario mentions them.

**Observed.** The shipped barrel exports exactly the three banner parsers
the requirement forbids:

- `packages/cli/src/core-surface.ts:127-130` — VOCABULARY, under the comment
  `// Banner readers (documented in the generate/verify workflow)`:
  `"parseBannerBaseline"`, `"parseBannerHashes"`, `"parseBannerVersion"`.
- `packages/cli/src/index.ts` value re-export list carries all three.
- `packages/cli/test/exports.test.ts:113-115` pins all three into
  `HEJBRO_RUNTIME_EXPORTS`.
- Runtime, from the built artefact a user receives:

  ```
  $ node --input-type=module -e "import * as h from './packages/cli/dist/index.js'; \
      console.log(['parseBannerBaseline','parseBannerHashes','parseBannerVersion'].map(n=>n+'='+typeof h[n]).join(' '))"
  parseBannerBaseline=function parseBannerHashes=function parseBannerVersion=function
  ```

The `ENGINE` list (`core-surface.ts:138-243`) contains no banner parser at
all — `renderBanner` (a renderer) and `parseSnapshot` (the snapshot parser)
are there, but the phrase "banner … parsers" has no referent inside ENGINE
and names three VOCABULARY members instead.

**Why it is a defect.** The requirement is the shipped contract. As written
it says `parseBannerHashes` is not on `hejbro`, while
`skills/hejbro/references/generate-verify-workflow.md:34-39` tells users
literally the opposite — "hejbro exports a parser for each marker a banner
can carry", followed by
`import { parseBannerBaseline, parseBannerHashes, parseBannerVersion } from "hejbro";`.
A reader of the spec would judge that skill snippet broken, or would remove
the three exports to satisfy the spec and break a documented user contract.
This is a normative `SHALL NOT` contradicted by shipped behaviour, not a
wording preference.

**Repair.** Two edits, both inside the first requirement:

1. In the `SHALL NOT` enumeration, replace `banner and snapshot parsers`
   with `the snapshot codec and the banner renderer` (or simply
   `snapshot parsers`), so the forbidden set matches ENGINE.
2. Add the banner readers to the stated exceptions, next to the brand
   sentence — e.g. "The three banner readers the skill documents as `hejbro`
   exports (`parseBannerBaseline`, `parseBannerHashes`,
   `parseBannerVersion`) stay exported, as does the one brand another
   shipped requirement names as reaching users through `hejbro`
   (`leftJoinedBrand`)."

`proposal.md` already carries both facts correctly; only the delta spec —
the artefact that survives archiving — is wrong.

---

## M1 (MINOR) — the type-reachability SHALL has no gate, while both runtime SHALLs do

The first requirement states:

> Every type `@hejbro/core` exports SHALL stay reachable from `hejbro`; only
> runtime values are curated

and scenario *Types are untouched* promises the same. The second
requirement then specifies the machinery — but only for values: the
completeness check is over "any runtime export of `@hejbro/core`", and the
pin is over "`hejbro`'s runtime export set".

**Observed.** Today the promise holds, exhaustively (TypeScript compiler
API over the two shipped `.d.ts` entries):

```
core exported names: 401 | with type meaning: 198
core type names NOT present on hejbro: []
```

But the only type-level assertion in the suite is a spot check:
`packages/cli/test/exports.test.ts:15-24` type-imports eight names, of which
exactly one (`DeclaredCteMarker`) is core's — 1 of 198. A regression that
narrowed `export type *` to an explicit list, or a future
`@hejbro/query` type name colliding with a core type name under the two
star exports, would drop core types from `hejbro` with every gate green.

**Why it is a defect.** Not a contradiction — shipped behaviour satisfies
the requirement — but the delta asserts a `SHALL` about types beside two
`SHALL`s about values that it explicitly arms with machine checks, and only
the value half is armed. The asymmetry is invisible in the spec.

**Repair.** Either extend requirement 2 to say the type surface is not
pinned by machine and why (the `export type *` construct is the guarantee),
or add a scenario requiring a check that every core type name is reachable
from `hejbro` — the second is cheap: the check above is ~10 lines against
core's and `hejbro`'s `.d.ts`.

---

## Checked and clean

**Scenario: Autocomplete offers the vocabulary** — holds exactly as
written. Against `packages/cli/dist/index.js` (114 runtime exports):
`real=function`; `'renderExpr' in h === false`, `'renderSnapshot' in h ===
false`, `'SELECT_CLAUSE_TRAVERSALS' in h === false`; all 97 ENGINE names
checked, `engine leaked into barrel: []`. The compile-time half was probed
against the shipped `.d.ts` (`paths` mapped to
`examples/postgres/node_modules/hejbro/dist/index.d.ts`, options from
`tsconfig.base.json`):

```
p1-value.ts(3,20): error TS1362: 'renderExpr' cannot be used as a value
  because it was exported using 'export type'.
```

**The type-only-visibility sentence is precisely right.** The delta says an
engine name is "usable in a `typeof` position, never as a value". Probed
both forms: `import { renderExpr } from "hejbro"; type R = typeof renderExpr;`
compiles with zero errors, as does `import type { renderExpr,
SELECT_CLAUSE_TRAVERSALS } from "hejbro"` used in `typeof` positions
(`isolatedModules: true`). The delta says exactly what happens; no
overclaim, no underclaim.

**Scenario: Types are untouched** — every one of core's 198 type-meaning
exports resolves from `hejbro` (see M1 for the evidence and the gap in
*enforcement*, not in behaviour). Spot-probed
`KindRegistry`, `Preset`, `MigrationPrefixStrategy`, `LeftJoinedBrand`,
`UntrackedJoins`, `SelectResult` through `hejbro`: all resolve.

**Scenario: The engine stays where presets import it from** — all 204 core
runtime exports still resolve from `@hejbro/core`
(`stale: []` — no VOCABULARY/ENGINE name is missing from core), and
`TURBO_FORCE=1 pnpm check-types` (16/16) and `TURBO_FORCE=1 pnpm test`
(17/17 tasks; `hejbro:test` 62 files / 502 tests) are green across every
preset and example. UNVERIFIED: the literal "exactly as before" comparison
against the pre-change core surface — no git history was read, per the
gate's isolation rules; the equivalent evidence is that no core file is
touched by the two lists and all sibling packages compile and test green.

**Requirement: the classification is complete.** Executed:

```
core runtime exports: 204   VOCAB 107   ENGINE 97
{ unclassified: [], twice: [], stale: [] }
```

The test at `packages/cli/test/exports.test.ts:288-302` computes exactly
`unclassified` / `twice` / `stale` and asserts them empty.

**Scenario: An unclassified core export fails the build** — verified by
executing the same assertion with a synthetic newcomer injected into
`Object.keys(core)`:

```
AssertionError: expected { unclassified: [ 'zzNewCoreExport' ] }
  to deeply equal { unclassified: [] }
```

It fails, and it names the export. (Probe file
`packages/cli/test/zz-d106-probe.test.ts`, deleted; `git status --porcelain`
clean.)

**Scenario: The barrel's composition is pinned** — the exact-set pin exists
at `packages/cli/test/exports.test.ts:318-322`:
`expect(Object.keys(hejbro).sort()).toEqual(HEJBRO_RUNTIME_EXPORTS)`, a
hand-maintained sorted list of 114 names (`:28-143`). It pins the **source**
barrel (`../src/index`), not `dist`; the built artefact was independently
enumerated and matches the list exactly, name for name. Verified by
execution that a single missing name fails naming the difference:

```
AssertionError: expected [ 'HejbroError', 'and', 'asc', …(111) ]
  to deeply equal [ 'and', 'asc', …(111) ]
+   "HejbroError",
```

**Composition of the 114.** 107 VOCABULARY + `@hejbro/query`'s full runtime
surface (`compile`, `createNameKeyedDb`, `db`, `defaultContextRendering`,
`sql`, `throwMissingCapability` — 6, one of which, `sql`, is also a
VOCABULARY name) + the package's own `defineConfig` and `assertSchema`.
That is what requirement 1's "together with `@hejbro/query`'s surface and
its own configuration and assertion entries" describes.

**Docs, skills and examples that would now lie.** Scanned every tracked
`.ts`/`.tsx`/`.md` for an `import … from "hejbro"` naming an ENGINE symbol.
Exactly one hit: `docs/plans/2026-08-20-phase7-implementation.md:1150`
(`checkChain, emptySnapshot, generateMigration, renderSnapshot`). `AGENTS.md`
designates `docs/plans/` as the historical record of the 0.1.x line, not
user-facing guidance, so this is not raised as a finding. No hit in
`README.md`, `docs/guide/`, `skills/hejbro/`, or `examples/`.
`skills/hejbro/references/generate-verify-workflow.md:77-85` correctly
attributes `generateMigrations`/`generateMigration` to `@hejbro/core`, and
`skills/hejbro/SKILL.md:26` carries the corrective sentence ("the `hejbro`
barrel carries the declaration and query vocabulary only, never the
engine"). `examples/{postgres,supabase}/test/chain.test.ts` import their
engine names from `@hejbro/core`, and both packages declare
`@hejbro/core` in `dependencies`.

**Shipped specs that name exports reaching users through `hejbro`.** Three
mentions across `openspec/specs/`:
`query-type-inference/spec.md:113-117` names `leftJoinedBrand`,
`UntrackedJoins`, `LeftJoinedBrand` and `SelectResult` as reaching users
through `hejbro` — the one value of the four, `leftJoinedBrand`, is in
VOCABULARY and present at runtime; the other three are types and resolve
through `export type *`. `value-utilities/spec.md:11-19` requires
`assertNoNulls` importable "from the `hejbro` facade" — in VOCABULARY,
`typeof === "function"` at runtime. `migration-apply/spec.md:363` is about
the `hejbro` *schema* in Postgres, not the package. No shipped spec names
any ENGINE symbol in an import/export sentence.
