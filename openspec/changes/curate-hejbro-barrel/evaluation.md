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

---

# Round 2

**PASS — 0 blocking, 0 major, 1 minor**

Scope: the `package-surface` delta as rendered by
`openspec show curate-hejbro-barrel --diff`, judged afresh against the
public surface it describes. Everything below was verified by execution
against the **worktree** build unless marked UNVERIFIED.

> Method note, because it changed a verdict mid-round: a probe whose
> `paths` were interpolated by the outer shell silently resolved
> `"hejbro"` to the **main checkout** (`.../hejbro/packages/cli/dist`),
> i.e. the pre-change barrel, and reported that a value import of
> `renderSnapshot` type-checks. Re-run with the worktree path hardcoded,
> it is `TS1362`. Every compile result below is from the corrected
> configuration (`tsc --traceResolution` confirms
> `hejbro-worktrees/curate-hejbro-barrel/packages/cli/dist/index.d.ts`).

---

## M2 (MINOR) — the requirement states a selection rule for the type check that does not produce the check that exists

Requirement 1 now says the type half of the curation is

> held by the barrel's construction (a wholesale type re-export, not a
> list) and **checked by a type-only import of the core types shipped
> specs name**

**Observed.** The check is `packages/cli/test/exports.test.ts`'s
`_CoreTypesPresent` block — eleven core types: `DeclaredCteMarker`,
`LeftJoinedBrand`, `UntrackedJoins`, `FunctionDeclaration`, `Table`,
`TypeNode`, `ReturningProjection`, `SelectLimited`, `InsertFinal`,
`UpdateFinal`, `DeleteFinal`. Grepping every shipped spec for each name
as a backticked identifier:

```
LeftJoinedBrand   openspec/specs/query-type-inference/spec.md:114
UntrackedJoins    openspec/specs/query-type-inference/spec.md:114
Table             openspec/specs/query-type-inference/spec.md:702  (passing prose,
                  "directly from a `Table` value at compile time" — not a named export)
DeclaredCteMarker, FunctionDeclaration, TypeNode, ReturningProjection,
SelectLimited, InsertFinal, UpdateFinal, DeleteFinal   — no shipped spec names them
```

So two of eleven are core types a shipped spec names as a contract
export; eight are not named by any spec at all. The stated rule is not
the list's membership rule.

**Why it is a defect.** Not a contradiction — the check does contain the
types shipped specs name, and the behaviour it guards holds — so this is
not blocking. But the delta is the artefact that survives archiving, and
it states the check's composition as derived ("the core types shipped
specs name") when it is hand-picked. A maintainer who later adds a core
type to a shipped spec will read this clause as saying the check already
covers it; it does not, and nothing fails.

**Repair.** One clause: say what the list actually is — e.g. "checked by
a type-only import of a representative set of core types, including the
ones shipped specs name as reaching users" — or make the sentence true by
restricting the block to the spec-named types and moving the rest to a
comment.

---

## Checked and clean

**Scenario: Autocomplete offers the vocabulary** — both halves hold, as
written. Runtime, against the built artefact a user receives
(`packages/cli/dist/index.js`, 114 runtime exports): `real=function`;
`renderExpr`, `renderSnapshot`, `SELECT_CLAUSE_TRAVERSALS` all absent;
all 97 ENGINE names checked — `engine leaked into barrel: []`,
`vocab missing from barrel: []`. Compile-time, `tsc` 5.9.3 against the
shipped `.d.ts`:

```
pv.ts(2,18): error TS1362: 'renderExpr' cannot be used as a value because
  it was exported using 'export type'.
```

and a sibling probe using `typeof renderExpr`, `typeof renderSnapshot`
and `typeof SELECT_CLAUSE_TRAVERSALS` compiles with zero errors, as does
a value use of `real`, the three banner readers and `leftJoinedBrand`.
The delta's "usable in a `typeof` position, never as a value" is exactly
what happens — no overclaim, no underclaim.

**The banner readers and `leftJoinedBrand` are exported; every other
engine name is absent.** Runtime:
`parseBannerHashes=function parseBannerVersion=function
parseBannerBaseline=function leftJoinedBrand=symbol`. The exception is
earned, not asserted: `skills/hejbro/references/generate-verify-workflow.md:32-39`
documents "hejbro exports a parser for each marker a banner can carry"
with `import { parseBannerBaseline, parseBannerHashes, parseBannerVersion }
from "hejbro"`, and `openspec/specs/query-type-inference/spec.md:113-117`
names `leftJoinedBrand` as reaching users through `hejbro`.

**The forbidden categories now map onto ENGINE only.** The `SHALL NOT`
enumeration reads "renderers, codecs, the diff and generation machinery,
kind definitions and the registry, the snapshot codec, traversal tables,
and internal brands and helpers". Every phrase has a referent inside the
97-name ENGINE list (`renderBanner` is the renderer, `parseSnapshot` the
snapshot codec, `SELECT_CLAUSE_TRAVERSALS` the traversal table,
`columnOriginBrand`/`nestedReadBrand`/`readAsBrand` the internal brands),
and no phrase names a VOCABULARY member. Cross-checked the other
direction too: no VOCABULARY name falls under a forbidden category except
the two the requirement excepts explicitly.

**Requirement: the classification is complete and disjoint.** Executed
against the built core entry:

```
core runtime exports: 204   VOCAB 107   ENGINE 97   sum 204
{ unclassified: [], twice: [], stale: [], dupVocab: [], dupEngine: [] }
```

**Scenario: An unclassified core export fails the build** — mutation-probed
by execution (probe file `packages/cli/test/zz-d106r2-probe.test.ts`,
deleted; `git status --porcelain` clean afterwards). A synthetic newcomer
injected into the core key set, and a name forced into both lists, each
fail naming the offender:

```
AssertionError: expected { unclassified: [ 'zzNewCoreExport' ] } to deeply equal { unclassified: [] }
AssertionError: expected { twice: [ 'renderExpr' ] } to deeply equal { twice: [] }
```

**Scenario: The barrel's composition is pinned** — the exact-set pin is
`expect(runtimeKeys(hejbro)).toEqual(HEJBRO_RUNTIME_EXPORTS)` against a
hand-maintained sorted list. Verified it pins the *current* set, name for
name: 114 pinned, 114 in `dist`, `in dist not pinned: []`,
`pinned not in dist: []`, and the list is genuinely sorted as written.
Mutation-probed both directions by execution — an added and a removed
export each fail naming the difference:

```
+   "zzLeakedEngineName"
-   "real"
```

(The assertion runs against `../src/index`, not `dist`; the built artefact
was enumerated independently and matches exactly, so the distinction has
no consequence here.)

**The type-reachability check exists and would fail if a named type
stopped being exported.** `packages/cli/tsconfig.json` has
`"include": ["src", "test", …]` and `check-types` is `tsc --noEmit`, so
`_CoreTypesPresent`'s `import type { … } from "../src/index"` is compiled
by the repository's own gate. Verified the failure mode by execution
rather than by reasoning: a barrel that narrows `export type *` to an
explicit list (the exact regression the construction is supposed to make
impossible) produces `TS2305` for every dropped name — 10 of the 11:

```
use.ts(1,15): error TS2305: Module '"./narrow"' has no exported member 'DeclaredCteMarker'.
… (10 total)
```

**Scenario: Types are untouched** — exhaustive, via the TypeScript
compiler API over the two shipped `.d.ts` entries:

```
core exported names: 401 | with type meaning: 198
core type names NOT present on hejbro: []
```

None of the eleven names in `_CoreTypesPresent` is supplied by
`export * from "@hejbro/query"` (query's own export list carries none of
them), so each one really does prove core's type re-export arrived.

**Scenario: The engine stays where presets import it from** — all 97
ENGINE names still resolve from `@hejbro/core` (`engine names absent from
core: []`), and the whole monorepo is green under forced runs:
`TURBO_FORCE=1 pnpm check` (641 files), `pnpm check-types` (16/16, 0
cached), `pnpm test` (17/17 tasks, 0 cached; `hejbro:test` 62 files / 502
tests). UNVERIFIED: the literal "resolves exactly as before" comparison
against the pre-change core surface — no git history was read, per the
gate's isolation rules.

**The barrel's composition matches what requirement 1 promises.** 114 =
107 VOCABULARY + `@hejbro/query`'s full runtime surface (`compile`,
`createNameKeyedDb`, `db`, `defaultContextRendering`, `sql`,
`throwMissingCapability`, of which `sql` is also a VOCABULARY name) + the
package's own `defineConfig` and `assertSchema` — i.e. "together with
`@hejbro/query`'s surface and its own configuration and assertion
entries", exactly.

**Docs, skills and examples that would now lie.** Scanned all 989 tracked
`.ts`/`.tsx`/`.md`/`.mdx`/`.js`/`.mjs` files (excluding `node_modules`,
`dist`, `.turbo`, `coverage`) for any `import { … } from "hejbro"` naming
an ENGINE symbol. Three hits, none user-facing:
`docs/plans/2026-08-20-phase7-implementation.md:1150` (AGENTS.md
designates `docs/plans/` as the historical record of the 0.1.x line, not
guidance) and two inside this evaluation file itself (round 1's own probe
snippets). Zero in `README.md`, `docs/guide/`, `skills/hejbro/`,
`examples/`, or `packages/`. No namespace import (`import * as … from
"hejbro"`) or `require("hejbro")` anywhere either, so the named-import
scan is complete. `skills/hejbro/SKILL.md:26` carries the corrective
sentence and attributes `generateMigration` to `@hejbro/core`;
`generate-verify-workflow.md:77` attributes `generateMigrations` there
too.

**Shipped specs naming exports that reach users through `hejbro`.**
Grepped all 18 capabilities in `openspec/specs/` for each of the 97
ENGINE names as a backticked identifier: **zero hits**. The only
user-facing export sentences are `query-type-inference/spec.md:113-117`
(`leftJoinedBrand` — VOCABULARY, present at runtime; `UntrackedJoins`,
`LeftJoinedBrand`, `SelectResult` — types, all reachable) and
`value-utilities/spec.md` (`assertNoNulls` — VOCABULARY,
`typeof === "function"`). No shipped spec is contradicted.

---

## Round 1 findings — status

**B1 (BLOCKING, banner parsers) — repaired.** The `SHALL NOT`
enumeration no longer contains "banner and snapshot parsers"; it now
reads "… the snapshot codec, traversal tables, and internal brands and
helpers", and the requirement adds the exception explicitly: "Two groups
that read as engine are vocabulary on purpose and stay exported: the
three banner readers (`parseBannerHashes`, `parseBannerVersion`,
`parseBannerBaseline`) … and the one brand another shipped requirement
names as reaching users through `hejbro` (`leftJoinedBrand`)." Verified
by execution that the repaired text now matches shipped behaviour in both
directions: every forbidden phrase has a referent in ENGINE, no forbidden
phrase names a VOCABULARY member, and the two excepted groups are exactly
the ones exported (`parseBanner*` = function, `leftJoinedBrand` = symbol).
The justification the delta gives for each exception is checkable and
checks out (skill reference for the readers, shipped spec for the brand).

**M1 (MINOR, un-armed type SHALL) — repaired.** The requirement now
discloses the asymmetry instead of leaving it implicit: the type
guarantee is stated as "held by the barrel's construction (a wholesale
type re-export, not a list) and checked by a type-only import …", which
is the first of round 1's two suggested repairs, and the implementation
went further by adding a `_CoreTypesPresent` block that raises the
core-type spot check from 1 name to 11. Verified the check is compiled by
`pnpm check-types` and that narrowing `export type *` breaks it
(`TS2305` ×10). The residue is only the accuracy of the clause that
describes how those 11 were chosen — raised fresh as M2 above, not as an
unrepaired M1.
