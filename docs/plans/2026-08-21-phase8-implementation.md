# Phase 8 — Release readiness: Implementation Plan

Brainstorm resolved 2026-08-21 (owner-approved): decision log entries
**D58–D68**, plus an in-place amendment to **D33**. This plan turns those
decisions into 23 PRs, plus D69 and D70, added at plan review, plus D71 and
D72 and the PRs they brought with them — 34 rows as of 2026-08-22. The map is
a catalogue; the track queues below it are the schedule.

Issue: **#9**. Sub-issues filed from this phase's research: **#136**, **#137**,
**#138**, **#139**.

## The rule this phase runs on (D65)

> **0.1.0 is not a deadline — the format goes where it belongs first.**
> The question is *"is there an active reason not to do this now?"*, and
> the axis is *known defect or new feature*, not *does this change
> rendered output*.

Two consequences worth restating, because they are easy to get wrong:

- **"It does not change rendered output" is not a reason to defer.** A defect
  can leave rendering untouched and still hurt: #125 crashes with a raw
  `TypeError` on a new user's first command, and #129 fails a perfectly linear
  history so the user's CI goes red.
- **"Our committed artifacts change" is not the same as "the format changes."**
  Translating a golden fixture's trigger message (#120) or removing a
  workaround from our own showcase (#113) regenerates files we own; it does not
  change how an unchanged *user* declaration renders. Only the second kind
  forces the format wave.

Both were learned the hard way: three "safe to defer" judgements were
overturned during the brainstorm (`serial` emitting invalid SQL, #24 concealing
a silently dropped primary key, and both of #110's cheap options being breaking
after publication).

## Owner decisions — do not revisit

| Decision | Settled |
|---|---|
| D58 | `engines: ">=22.18.0"` on every published package + Node 22 in the CI matrix; D13's floor unchanged |
| D59 | Changesets, published packages in a **fixed (lockstep)** group, one `.changeset/*.md` per PR |
| D60 | First version **0.1.0**; no separate pre-1.0 policy document |
| D61 | **Maximum set** before publishing; 0.2.0 keeps #130, #131, #132, #139 |
| D62 | **No npm channel** for `@hejbro/skills` — repository distribution only, package is `private` |
| D63 | **Automated publishing** via `changesets/action`; the human gate is approving the "Version Packages" PR; AGENTS.md updated to match |
| D64 | GitHub Pages docs site is a **follow-up**, not Phase 8 |
| D65 | The judgement rule above |
| D66 | #23 as a **`sequence` object kind**, `serial` kept and modelled |
| D67 | #110 fixed with **(b)** — structured expression nodes; D33 amended |
| D68 | **Snapshot `formatVersion` → 5**, carrying #110(b) and #24(iii) |
| D69 | The Supabase preset is **verified against a real `supabase/postgres` image** before publishing — a second local-Docker script, not CI |
| D70 | Expression nodes **serialize by D57's rules** — kebab-case discriminators and `schema`/`table` reference fields in the snapshot, camelCase in the TypeScript union |
| D71 | **CRAP is gated** (`CC² × (1 − coverage)³ + CC`) for `@hejbro/core` and `@hejbro/supabase` — at 10 first, then ratcheted to 5 in this same phase. At 100% coverage `CRAP = CC`, so each threshold is a cap on cyclomatic complexity. The CLI is out of scope: subprocess e2e coverage is invisible to in-process V8 |
| D72 | A view's own query is stored as a structured `SelectNode` too (D67's precedent applied to `ViewSnapshot.selectSql`, D27's original shape) — **not a defect fix**, done pre-publication because it changes how an unchanged view declaration renders (D65). `formatVersion` stays **5**: v5 was opened by D68 for this class of change and carries the view field as well, not a new bump |

Constraints that came with them, and that a later PR must not quietly undo:

- **`authUid()`'s rendered output (`auth.uid()`) must not change.** It is
  already committed in three policies of
  `examples/supabase/hejbro.snapshot.json`. The cached form is a **new,
  additive export** (#97).
- **Do not add `ExprNode` kinds outside the v5 wave.** With expressions stored
  structurally, a new node kind extends the snapshot's vocabulary; an older
  build reading a newer snapshot passes the `formatVersion` check and then
  reaches `assertNever` — a crash, not a diagnostic.
- **`diverged-migrations` and `broken-chain` message texts are owner-approved
  (O2) and pinned in goldens.** #129 widens what `verify` accepts; it does not
  reword those two.
- **Core stays pure.** No runtime dependency may be added to `@hejbro/core`
  (hard gate).

## Global constraints

- Every PR carries exactly one `.changeset/*.md` once `phase8-changesets` has
  landed (D59) — including `phase8-changesets` itself, which carries a
  `minor` changeset (introducing the release infrastructure is not a patch).
  PRs before that do not.
- Every PR body lists the commits to be squashed and references its issue. The
  phase issue stays open: use `Refs #9`, and `Closes #N` only for the specific
  issue a PR finishes.
- All GitHub-facing text is English.
- `pnpm check`, `pnpm check-types`, `pnpm test` pass before any PR is called
  done, with output shown.
- Work happens in a worktree under `../hejbro-worktrees/`; feature branches
  push to `upstream` (the org repo), verified with `git ls-remote --heads
  upstream <branch>`.
- Never delete `dist/` or other build output inside another agent's active
  worktree (#102's root cause).

## Regeneration procedure

Two artifact sets regenerate, and they cost very different amounts.

**Goldens — free, one command.** `UPDATE_GOLDEN=1 pnpm test` rewrites every
`expected/*.sql` and `expected/snapshot.json` under
`packages/core/test/golden/cases/` (the harness walks the directory, so new
cases are picked up automatically). Golden SQL files contain **no** banner hash
lines — the harness calls `generateMigration` without `bannerHashes` — so a
format change costs nothing there. Until `phase8-snapshot-v5` declared
`UPDATE_GOLDEN` in `packages/core/turbo.json`'s `test` inputs, this root-level
form silently did nothing — turbo does not forward undeclared env vars to
task processes, so the run passed through unchanged regardless of cache
state. Earlier phases used `pnpm --filter @hejbro/core test`, which bypasses
turbo and therefore worked; this line's own root-level form was untested
until now.

**Examples — scripted by `phase8-regen-script`, manual before it.** The eight
committed example migrations
(`examples/{postgres,supabase}/migrations/0001…0004`) *do* carry
`parent-snapshot:`/`snapshot:` lines, and core never hashes (D33) — only the
CLI does. Regenerating therefore means driving the built CLI once per step.
`scripts/regen-examples.sh` (`phase8-regen-script`) automates this and
**enumerates the step files** rather than hard-coding four, because the
chains grow in `phase8-constraint-names` and `phase8-grant-sync`.

**Commit split.** Any PR that regenerates examples splits its commits in two:
*declaration and code changes* first, *regenerated artifacts* second, with the
PR body stating that the second commit is the output of
`scripts/regen-examples.sh`. Reviewers read the first commit; the second is
machine output.

## Example chains are a regression line (D48/D49 unchanged)

The round-trip compares a chain-built database against a freshly built one.
That makes it precisely the instrument for **asymmetric** defects — and two of
this phase's bugs are exactly that: #137's drop path (removing a column from a
composite primary key leaves the chain database with no primary key, while a
fresh build has one) and #121 (a schema-wide grant never reaches tables added
later). It missed both only because the example chains contain neither a
primary-key change nor a table added under a schema-wide grant.

Rule going in: **every step defends at least one defect class**, recorded in a
comment at the top of the step file and in `examples/README.md`, with the issue
number. The chain is a showcase and a regression line, not a catalogue of
features.

This also settles two of the open verifications below: `add primary key`
without a constraint name, and what Postgres does to a composite primary key
when one of its columns is dropped, are both answered by real Postgres rather
than by our reading of the docs.

## PR map

Ordering constraints, by branch name rather than row number:
`phase8-error-subclass` → `phase8-loader-diagnostics` · `phase8-snapshot-v5` →
`phase8-grant-sync` · `phase8-regen-script` before the whole format wave ·
`phase8-snapshot-v5` first within it (one bump) · `phase8-packaging` before any
release · `phase8-changesets` before every later PR's changeset.

**Refer to PRs by branch name, not by row number.** The numbers below are
reading order and shift whenever a PR is inserted — which already produced two
stale references in review (a chain step attributed to PRs that did not own it,
and "the chains grow in 17 and 18" pointing at a golden-translation PR). Branch
names do not move. If a number does end up in prose, re-check every one of them
when the map changes.

| # | PR | Scope | Issues |
|---|---|---|---|
| 1 | `phase8-plan` | This plan, the D58–D70 rows, the D33 amendment, the roadmap section, the AGENTS.md hard-gate change | Refs #9 |
| 2 | `phase8-packaging` | #86 pack-install smoke test **and the packaging it proves**: LICENSE in all three published packages, a README for `hejbro`, `homepage`/`bugs`/`keywords`, `prepack`; `engines` (D58) + Node 22 CI matrix; `@hejbro/skills` → `private: true` (D62); root `typescript` → `catalog:` | #86, #28 |
| 3 | `phase8-changesets` | `.changeset/config.json` (`fixed` group of the three published packages, `access: "public"`, `baseBranch: "dev"`, `updateInternalDependencies: "patch"`), release scripts, the changeset rule in AGENTS.md | — |
| 4 | `phase8-regen-script` | `scripts/regen-examples.sh` + `pnpm regen:examples` | — |
| 5 | `phase8-release-workflows` | `release-version.yml` (on `dev`, version only) and `release-publish.yml` (on `main`, publish only), `NPM_CONFIG_PROVENANCE`, `id-token: write`, and the pre-publish gate (`check`/`check-types`/`test`/`build` + the #86 smoke). Deferred past the format wave; not yet scheduled (see the phase issue). | — |
| 6 | `phase8-error-subclass` | `HejbroError` becomes an `Error` subclass; both duck-typing sites (`commands/generate.ts`, `commands/verify.ts`) switch to `instanceof` | #25 |
| 7 | `phase8-loader-diagnostics` | Declaration/config load failures become diagnostics instead of a raw `TypeError` | #125 |
| 8 | `phase8-chain-walk` | `verify` accepts a chain that returns to an earlier snapshot state. Deferred past the format wave; not yet scheduled (see the phase issue). | #129 |
| 9 | `phase8-flag-equals` | `--flag=value` token form | #89 |
| 10 | `phase8-symbol-for` | `Symbol.for` for `tableMeta` and `triggerRowMeta` | #138 |
| 11 | `phase8-next-marker` | `Next:` retrofit across the user-facing throw sites | #87 |
| 12 | `phase8-snapshot-v5` | `formatVersion` → 5, parser handling, **and** the version-mismatch message (#136); snapshot deep-validation (#26) | #136, #26 |
| 13 | `phase8-expr-nodes` | Expressions stored as structured nodes; rename retargets them (D67) | #110 |
| 14 | `phase8-sequence-kind` | `sequence` object kind, rename drift guard, type-change semantics | #23 |
| 15 | `phase8-constraint-names` | Constraint names in the snapshot (#24(iii)), pk/unique alter emission, #137's full fix replacing `phase8-pk-guard`'s guard, **and the chain step that exercises the PK add and drop paths** | #24, #137 |
| 16 | `phase8-pk-guard` | Extend the `unsupported-column-alter` guard to the `added`/`removed` paths so the silent omission becomes a loud refusal | #137 |
| 17 | `phase8-grant-sync` | Schema-wide grants follow tables added later, **plus** a chain step that adds a table under a schema-wide grant | #121 |
| 18 | `phase8-golden-english` | Golden trigger messages translated to English | #120 |
| 19 | `phase8-policy-predicates` | RLS predicate widening; the showcase drops **56 workaround expressions inside 34 `see #113`-marked policy blocks** — done = both counts 0, per-file distribution reported | #113 |
| 20 | `phase8-bucket-notes` | Field-level notes for bucket alters; empty note lists stop rendering `[]` | #116 |
| 21 | `phase8-authuid-cached` | `authUid()`'s cached variant (reusing the existing `rawSql` node), a `warning[rls-uncached-auth-call]` validator, and the **12 call sites across 5 files** that teach the uncached form | #97 |
| 22 | `phase8-supabase-image` | `scripts/verify-supabase-image.sh` — the preset checked against a real `supabase/postgres` image (D69) | — |
| 23 | `phase8-docs-release` | README status and install instructions, `CONTRIBUTING.md`, then the 0.1.0 release | — |
| 24 | `phase8-crap-tooling` | `@vitest/coverage-v8`, a `test:coverage` task, `scripts/check-crap.mjs` — **reports only, not wired into CI** | #154 |
| 25 | `phase8-crap-refactor` | The 13 functions at complexity ≥ 10 — at that complexity nothing below 100% coverage clears the threshold, so these need a split, not tests | #154 |
| 26 | `phase8-crap-coverage` | The 4 functions at complexity 8–9, which clear at 70–77% coverage | #154 |
| 27 | `phase8-crap-gate` | `check:crap` wired into CI with a non-zero exit, **and the D71 decision-log row** | #154 |
| 28 | `phase8-diagnostic-xref` | A check that every error code quoted inside a diagnostic message actually exists; **`style/noTernary` turned on in `biome.json`** and the 7 existing violations fixed; the `.mjs` style-rule scope question, answered `yes` | — |
| 29 | `phase8-view-nodes` | `ViewSnapshot.selectSql` becomes a structured node (the 5th and last pre-rendered field), rename retargeting extended to views, **D72** | #157 |
| 30 | `phase8-preset-goldens` | `stripBanner`'s division of labour written down, and the `create` banner pinned — `drop` and `alter` already are | #167 |
| 31 | `phase8-crap-ratchet-5` | The remaining 29 violations resolved, then `CRAP_THRESHOLD = 5` | #154 |
| 32 | `phase8-roadmap-sync` | The roadmap's Phase 8 section gains the coverage-gating work group and #157 — the two things the brainstorm did not know about | #154, #157 |
| 33 | `phase8-cli-timeout` | `packages/cli` has no `testTimeout`, so its subprocess e2e chain runs against vitest's 5s default and flakes under runner contention — now a merge blocker, since `verify (22)`/`verify (24)` became required checks | #173 |
| 34 | `phase8-plan-rules` | This file: the rules measured during the phase, the rows added after plan review, the track queues, D71 and D72 | — |

`phase8-pk-guard` lands **before** `phase8-constraint-names` in dependency
terms but is listed after it for readability: the guard is a small, independent
PR that can go as early as the diagnostics wave, and `phase8-constraint-names`
then replaces it with real SQL.

## Track queues

Since 2026-08-22 the work runs on three parallel tracks split by file area, so
the table above is a catalogue, not a schedule. **These queues are the
schedule**, and they are stated by branch name for the reason given above.

| Track | Area | Queue |
|---|---|---|
| A | `packages/core/src/expr`, `packages/core/src/kinds`, core semantics | `expr-nodes` → `view-nodes` → `sequence-kind` → `constraint-names` → `chain-walk` → `crap-refactor`/`crap-coverage` (core half) → `crap-ratchet-5` |
| B | `.github/workflows/`, `scripts/`, `docs/` | `release-workflows` → `crap-tooling` → `roadmap-sync` → `cli-timeout` → `diagnostic-xref` → `supabase-image` → `docs-release` |
| C | `examples/`, golden content, `packages/supabase` | `golden-english` → `bucket-notes` → `preset-goldens` → `crap-coverage` (the `supabase/validators/schema-of.ts` entry) |

Track A is the bottleneck and cannot be widened: core semantics are sequential
and format-dependent, so a fourth pair of hands there produces conflicts rather
than throughput. The lever is being stricter about what enters track A at all.

**One open PR at a time per implementer when root files are involved.** The
track split prevents conflicts *between* tracks; it does nothing about two PRs
open *within* one. `phase8-release-workflows` and `phase8-crap-tooling` were
both track B, both by the same implementer, both open at once, and both edited
the root `package.json` and `pnpm-lock.yaml` — the second merged and the first
went `CONFLICTING`. Those files were already recorded as this phase's
third-ranked conflict source before either PR existed. So: a second PR that
touches `package.json`, `pnpm-lock.yaml`, `turbo.json` or `ci.yml` waits for
the first to merge and then rebases, or branches off the first. Checking this
is part of assigning, not part of reviewing.

**Entry filter for track A**: anything proposed for this queue is first asked
*"does this have to happen before publication?"*, and the answer travels with
the proposal. Most of the queue is there because D65 leaves no choice — a
snapshot's shape cannot change after 0.1.0 without a format version and a
migration path. `phase8-crap-ratchet-5` is currently the only entry with no
pre-publication deadline of its own; it is a CI threshold, not a format
change. Recording that now matters because if the release runs late, the
pressure lands first on the items that cannot move.

## Per-PR completion criteria

Beyond the global gates (`check`, `check-types`, `test`), each PR proves its
own claim.

- **`phase8-packaging`** — the Node 22 matrix entry has to actually run. The
  root `package.json` declares `engines: { node: ">=24.0.0" }`, which is
  stricter than D13's own text ("the repo's own toolchain requires ≥ 22.18.0")
  and would fail install on the new matrix job. Lower the root to `>=22.18.0`
  so the repo's declaration, D13 and the published `engines` all agree; do not
  paper over it by disabling the engine check. The smoke test packs each
  published package with `pnpm pack` — the tool `changeset publish` actually
  uses under the hood for this pnpm workspace (D59/D63) — installs the tarball
  into a scratch project with plain `npm install`, and runs
  `init`/`generate`/`verify` there. Measured against the unpacked repo: the
  `workspace:*`-absence and bin/CLI assertions already pass on a
  `pnpm`-packed tarball, so they land as regression guards, not as the red
  this PR turns green — what's actually red beforehand is the `hejbro`
  tarball packing no `README.md` (missing package-level file). `npm pack`
  (as opposed to `pnpm pack`) does leave `workspace:*` unresolved and produces
  a tarball `npm install` rejects with `EUNSUPPORTEDPROTOCOL` — reproduced
  during this PR — but fixing that would mean dropping the `workspace:`
  protocol or rewriting dependency strings in `prepack`, both against D59's
  direction, so the smoke packs with `pnpm` (what release actually ships) and
  keeps the `npm pack` failure as the documented reason its two regression
  assertions matter. That leaves a gap this PR does not close: the smoke
  proves a `pnpm`-packed tarball installs cleanly, not that the real release
  workflow packs with `pnpm` — `changeset publish`'s pnpm workspace detection
  is automatic, and if it silently stops applying (or a workflow edit swaps in
  `npm publish`), the smoke stays green while the shipped tarball breaks.
  `phase8-release-workflows` closes this gap; see its row below. The CI leg
  also proved the script portable — `mktemp -d`, `tar -tzf`, `grep -qxF` and
  the here-string all behave on a Linux runner, which local macOS runs cannot
  show.
- **`phase8-changesets`** — `changeset status` runs clean; a dry version run
  bumps the three packages together. Document in `CONTRIBUTING.md` that the
  **first release needs a `minor` changeset**, since an all-`patch` set would
  publish `0.0.1`. "Runs clean in CI" is not free: the requirement to prove
  `baseBranch: "dev"` actually works in CI (not just in local config)
  produced a real failure — `changeset status` shells out to `git merge-base
  dev HEAD`, which needs a local branch literally named `dev` that a
  `pull_request` checkout never creates on its own. The requirement earned
  its keep by finding this before release did — and the failure mode itself
  is worth noting: `changeset status` doesn't silently pass when its
  `baseBranch` ref is missing, it hard-fails with a stack trace (see
  `ci.yml`'s comment on the fetch step), which is exactly why the CI break
  was visible instead of a quiet false green. Prove `fixed` is the cause
  of the three packages moving together, not a coincidence of all three
  starting at `0.0.0`: take one package out of `fixed` and show it stops
  moving *the same way*, not just that it stops moving — changesets patch-
  bumps any dependent of a released package by default, `fixed` membership
  or not, so "the removed package doesn't move at all" was never an
  achievable outcome to demand. Four requirements or claims in this PR's
  review turned out to be wrong, not just the implementation checking
  them — worth keeping in one place with who introduced each, because a
  requirement is as capable of being unverified as an implementation is,
  and because the four are genuinely different failures, not one mistake
  repeated: (1) the acceptance wording for this criterion originally asked
  for exactly that unachievable outcome — "only that package stops
  moving" — fixed by changing what the proof showed, not by abandoning
  it; (2) a separate instruction asked this PR to confirm whether
  `changeset status --since=<base>` closes an enforcement gap, on the
  premise that the flag itself would matter — it doesn't, in either
  direction, since `baseBranch: "dev"` already supplies it; (3) that
  instruction was itself downstream of relaying an observation into a
  requirement without independently verifying it first; (4) the
  observation being relayed was a green read the wrong way — measured
  with the changeset removed but the package left unchanged, so the gate
  had nothing to catch (see "a green proves nothing unless the defect was
  actually present" below). (1) and (2) are unverified *requirements*;
  (3) is passing a claim along without checking it; (4) is a green
  wrongly read as absence-of-enforcement — distinct failures, not the
  same one four times. Requesters and reviewers are gates too — the same
  discipline applies. See the `updateInternalDependencies` write-up below
  for the same "vary what you credit" lesson applied to a causal claim
  rather than a requirement.
- **`phase8-regen-script`** — running the script reproduces the committed
  example migrations and snapshots **byte for byte** before any format change.
  That is the script's own test. Prove the script's range by mutation:
  hand-edit a committed example migration and confirm regeneration overwrites
  it back (valid despite being an artifact-level edit — the regeneration
  script is the producer under test here, so healing *is* the correct
  behavior, the mirror image of `phase8-packaging`'s `dist`/`prepack` trap),
  and drop a step file and confirm the script notices rather than silently
  regenerating fewer steps.

  **This last part was originally written assuming the chain would
  otherwise shrink silently — checked by neither the instruction that
  asked for it nor its relay.** It doesn't: `pnpm test` already has two
  gates that catch a deleted step (`chain.test.ts` imports each step file
  statically, so a missing one is a module-resolution failure; `cli.test.ts`
  asserts an exact migration count via `toHaveLength`). What the three
  devices actually differ on is *when* and *how clearly*:

  | Device | Surfaces | Says |
  |---|---|---|
  | the script's own shrink check | at regeneration time | names the likely cause ("a step file was likely deleted or renamed") |
  | `chain.test.ts` | in `pnpm test` | a bare module-resolution failure — requires inference |
  | `cli.test.ts` | in `pnpm test` | a length mismatch — catches growth too, but not *why* |

  So the script-level check is still worth having — for precision and
  timing, not because the phase would otherwise ship a silent gap.

  **Two more mutations, both found in review, are part of the same
  criterion:**
  - **A guard's own baseline must come from something the guard cannot
    itself change.** The first version of the shrink check counted the
    working tree just before wiping it — so a failing run left a *shorter*
    tree on disk, and rerunning the script (the ordinary response to a
    failure) compared that shrunk state against itself and passed. Fixed
    by reading the baseline from `git ls-files` (the index, untouched by
    anything this script does) instead of the filesystem.
  - **A step file existing is not the same as a step file doing anything.**
    A new step whose declarations don't differ from the previous one makes
    `generate` write nothing — step count and migration count silently
    diverge, and neither the shrink check nor either existing test notices
    (steps and migrations both stay ≥ what's committed). A second check,
    `regenerated-migrations == step-files`, catches exactly this; it's
    complementary to the shrink check, not redundant with it — a deletion
    keeps that equation balanced while shrinking the total, and a no-op
    step keeps the total from shrinking while unbalancing the equation.
- **`phase8-release-workflows`** — the workflows are validated against
  `changesets/action`'s `action.yml` (input names differ between versions; do
  not copy a draft blindly). The publish job must refuse to run if the
  pre-publish gate fails. It must also close the gap `phase8-packaging`'s
  smoke left open: that smoke proves a `pnpm`-packed tarball installs
  cleanly, not that the real release actually packs with `pnpm`. `changeset
  publish`'s choice of `pnpm publish` for this workspace is automatic
  detection (D59/D63), not a pinned setting — this PR needs to verify **which
  tool actually packed**, e.g. `pnpm publish --dry-run` output, or that the
  tarball manifest's internal dependency resolved to a semver version rather
  than a `workspace:` string. Checking for the string alone is the weaker
  form: measured during `phase8-packaging`'s review that npm already rejects a
  `workspace:` string in `dependencies`/`peerDependencies`/
  `optionalDependencies` at install time with `EUNSUPPORTEDPROTOCOL` — the
  string check only adds value for `devDependencies`, where npm installs
  without resolving. Prove the pre-publish gate by mutation: a tarball with a
  `workspace:` string must stop the publish job, and so must a stale `dist` —
  but mutate the **producer** for the second one, not the artifact.
  `phase8-packaging`'s own `prepack: "pnpm build"` rebuilds `dist` on every
  pack, so hand-editing a packed `dist` file proves nothing (reviewer found
  exactly this while verifying that PR: deleting a required `.d.ts` from the
  assertion's expectations passed only because `prepack` had already
  regenerated it). Disable or bypass the build step itself — e.g. temporarily
  remove the `prepack` script, or point the pack at a `dist` produced from an
  older commit — and confirm the gate still stops the stale tarball.

  An earlier draft of this criterion claimed the `AGENTS.md`
  changeset-presence rule was enforced only incidentally and asked this PR
  to add a real check. **That was wrong, checked by running it rather than
  reading the CLI's docs.** `check:first-release-version` and `changeset
  status` ask different questions and neither substitutes for the other:
  `check:first-release-version` asks *"is the first release 0.1.0?"* and
  **skips itself** once it is; `changeset status` asks *"does a changed
  published package have a changeset?"* and **keeps working** — it is
  already wired into CI and already enforces D59's rule, no `--since` flag
  needed, because `baseBranch: "dev"` in `.changeset/config.json`
  (`phase8-changesets`) is enough for it to diff against `dev` by default.
  Measured across five cells: the changeset present or absent, against
  nothing changed / a published package changed / a private-only package
  changed. The only red cell is *changeset absent + a published package
  changed*
  (`"Some packages have been changed but no changesets were found"`),
  identically with or without `--since=dev`. `phase8-changesets` already
  wires `changeset status` into `ci.yml`, so this enforcement is live from
  that PR onward and does not self-invalidate — nothing left for this PR to
  add here.
- **`phase8-error-subclass` → `phase8-loader-diagnostics`** — a test
  reproducing #125's crash (a config importing a package that is not
  installed) first, then the diagnostic. Both `asHejbroError` sites are
  converted. Also cover the shape `phase8-packaging`'s smoke produces: a
  config importing an **installed** package whose `exports` entry does not
  resolve — same duck-typing path, different failure shape (not-installed vs.
  installed-but-unresolvable). Re-run that mutation (break
  `@hejbro/supabase`'s `exports`, run `pnpm smoke:pack-install`) and confirm
  the failure now **names the package** instead of crashing in
  `toDiagnostic`.
- **`phase8-chain-walk`** — a chain that rolls back and then forward again
  verifies clean; the two O2-approved message texts are unchanged.
- **`phase8-next-marker`** — the count is roughly 75 user-facing throw sites;
  internal invariant guards (`unreachable`, `internal hejbro bug`) are **not**
  targets. Goldens are expected to be unaffected: the CLI golden pins two Phase
  5 codes that already carry `Next:`, and core's message assertions are
  substring or regex matches that appending to does not break. If a golden does
  move, stop and re-check the classification.
- **`phase8-snapshot-v5`** — the version-mismatch message is true after
  publication and no longer sends the user in a circle (delete the snapshot →
  `verify` says restore it from version control).
- **`phase8-expr-nodes`** — a rename retargets a policy `using`, a CHECK
  expression and a partial index predicate, with no drop/add pair left over.
  Expression nodes serialize by D70: kebab-case discriminators and
  `schema`/`table` reference fields in the snapshot, camelCase in the
  TypeScript union. Two things prove it: the codec round-trips both ways under
  test, and **`naming-conventions.test.ts` passes on v5 output with no
  carve-out added** — that test is what enforces this decision, so weakening it
  would defeat the purpose. It cannot enforce it as written, though: it checks
  a closed vocabulary (kind ids, prefix strategies, golden directory names, a
  few known fields), so a `constantOne` or a stray `columnName` inside an
  expression subtree would pass unnoticed. Extend it first with a case that
  walks a v5 snapshot recursively and asserts every discriminator value and
  every reference key, then make it green. Prove the extension by mutation,
  **against the producer**: make the expression codec emit a camelCase
  discriminator (and a `columnName` reference key), then confirm each turns
  the test red. Planting a token in a committed snapshot proves nothing —
  `naming-conventions.test.ts` builds its snapshot in memory
  (`buildSnapshot(...)`) and never reads the committed file, so the planted
  token is not merely healed on the next `generate`, it is never looked at
  in the first place — a stronger failure than the hand-edited-`dist` trap
  (see "Mutate the producer, not the artifact" below), which at least gets
  looked at before being overwritten. This is the device that got its own
  range mis-stated earlier in this same plan (see "And one rule for writing
  them" below), so the claim that it's been extended needs to be shown, not
  just made.
- **`phase8-sequence-kind`** — the invalid `alter column … type serial` path is
  closed; a column rename and a table rename both keep the sequence in step;
  `serial()` → `integer()` emits the default drop and the sequence drop.
- **`phase8-constraint-names`** — pk/unique changes emit drop + add using names
  taken from the snapshot; #137's add and drop paths are covered by tests, and
  the chain step added in this PR exercises them under real Postgres. A new
  chain step means `examples/postgres/test/chain.test.ts`'s static
  `step-N.schema` imports and `test/cli.test.ts`'s migration-count
  `toHaveLength` both need the new step added by hand — `phase8-regen-script`
  regenerates the files, it doesn't touch either test.
- **`phase8-pk-guard`** — a PK column added to an existing table is refused
  loudly rather than emitted without its constraint.
- **`phase8-grant-sync`** — a table added under a schema-wide grant reaches the
  grant; `pnpm --filter example-postgres roundtrip` produces an empty diff.
  Same reminder as `phase8-constraint-names`: the new step goes into both
  examples' `chain.test.ts` imports and `cli.test.ts`'s expected count by
  hand.
- **`phase8-authuid-cached`** — the skill reference, the README paragraph and
  the three example policies all move to the cached form. **The README's D45
  paragraph currently tells users to wrap the call themselves "until then";
  that text becomes false and must be rewritten** — the same class of defect as
  #136.
- **`phase8-supabase-image`** — see the section below. Prove the five failure
  conditions by mutation where feasible — at minimum a deliberately wrong
  `storage.buckets` stub column must fail the run.
- **`phase8-docs-release`** — README's `## Status` no longer says "Nothing is
  published yet"; install instructions exist; `CONTRIBUTING.md` states plainly
  that merging the version PR publishes immediately and that npm burns a
  version number even if it is unpublished. And **#142**: the three package
  READMEs drop the roadmap/phase-status framing entirely (an npm page has no
  use for a pointer to our roadmap file), not just a wording refresh.

## `phase8-supabase-image` — verifying the preset against a real image (D69)

**Why it is not redundant with the round-trip.** The two scripts answer
different questions and both are kept:

| | `scripts/roundtrip.sh` | `scripts/verify-supabase-image.sh` |
|---|---|---|
| Runs on | `postgres:17-alpine` | `supabase/postgres:17.6.1.165` |
| Asks | is the generator **deterministic** — does a chain-built schema equal a freshly built one? | does the preset **match the platform it targets**? |
| Compares | our output against our output | our assumptions against the real thing |

The round-trip cannot answer the second question by construction: it is a
symmetric comparison, so an error both sides make is invisible — the same blind
spot that let `serial` pass for two phases. And today `examples/supabase` runs
against a role and a `storage.buckets` table **we wrote ourselves**, which
makes the gap concrete.

`scripts/roundtrip.sh` already takes a `HEJBRO_PG_IMAGE` override, so "just
point the round-trip at the Supabase image" is a proposal someone will make —
and it does not work, because the round-trip's comparison is symmetric no
matter which image it runs on. This table goes into `examples/README.md` as
part of this PR, next to the round-trip's own description — for the same reason
each chain step records the defect class it defends. Someone will eventually
propose merging the two scripts, and the answer to "what would that lose?" has
to be written down where they will look.

**Pin the image, and enforce the pin.** `supabase/postgres` publishes new tags
constantly (the `.164` and `.165` builds landed on the same day), so the script
pins **`supabase/postgres:17.6.1.165`** — the current PG17 multi-arch tag,
matching the PG17 major the round-trip already uses.

The pinned **digest is checked, not commented**. After pulling, the script
resolves the image's actual digest, compares it against the recorded value, and
**fails on a mismatch** — a re-tag cannot silently change what was verified. A
comment would not do this: it only works if someone reads it, and nothing
breaks when it goes stale, which is exactly the failure mode this plan bans
elsewhere. The message follows §7's substance — what differs, why it matters,
and what to do about it (update the recorded digest in its own PR). It does not
use the literal `Next:` token: that belongs to the CLI diagnostic grammar Phase
5 defined, and `scripts/roundtrip.sh` already states its failures without it.
Matching the sibling script matters more than matching a grammar written for a
different medium. This also turns "a pin bump is its own PR" from a convention
into something the script enforces.

One implementation trap: `17.6.1.165` is multi-arch, so it has both a
manifest-list digest and per-architecture digests. Compare the
**manifest-list** digest (`docker inspect -f '{{index .RepoDigests 0}}'`), not
the local image ID — the latter differs between arm64 and amd64 and would fail
on a healthy machine.

**What counts as a failure.** At minimum:

1. The committed migration chain does not apply cleanly to the real image.
2. The `storage.buckets` stub's column set disagrees with the real table
   (names, types, nullability, defaults).
3. A role name or a grant the preset relies on does not exist, or does not
   carry the privileges assumed.
4. An RLS policy that uses `authUid()` does not behave as intended in the real
   `auth` environment.
5. An extension or schema the preset assumes (`auth`, `storage`, `pgcrypto`, …)
   is absent or differs.

**Any mismatch is a new defect, not a script bug.** File it as an issue under
#9 with the observed-vs-assumed difference, exactly as this phase handled
#136–#138. Given what the first honest look at the round-trip produced in Phase
7 (six defects) and what this brainstorm's research produced (four), expect
this to find something.

**Placement.** After `phase8-authuid-cached`, so that every preset change
(#116, #97,
#113) is already in, and before the docs-and-release PR — a mismatch
found here may change what the docs should say.

## Rules that apply to every PR

Each of these was paid for during the phase; none is a reminder.

Four of them share one shape, and it is worth naming before the list: **the
claim of having checked was wider than what was actually checked.** Not a wrong
answer — a right answer whose evidence covered less ground than the sentence
reporting it. "I ran the mutation" but not in the file the mutation was in. "I
ran the tests" but against a build made before the mutation. "I read it" but
one of the two files that had to agree. "It's frozen" but the SHA that gets
merged is not the SHA that was read. Each reads as diligence and each leaves
the same hole, so the fix in every case is the same: say what you checked, not
that you checked.

**A round trip proves preservation, not convention.** `decode(encode(x)) === x`
holds just as well when the spelling in between is wrong, because both
directions read the same table — so a symmetric test can never be evidence that
an encoding follows a naming rule. Anything asserting a *convention* has to pin
one end: assert against the table itself, or against a literal expected form.
Measured in `phase8-expr-nodes`: 21 green round-trip cases while `rawSql` was
reachable, user-facing (`sql.raw()`, D18), and encoded with no gate on its
spelling at all — breaking its entry in `NODE_KIND_TO_SNAPSHOT` left the entire
root `pnpm test` green. This applies to every encode/decode pair here, not just
the expression codec.

**A claim about machinery you do not control has to be executed, not reasoned
about.** Code we own is caught by our own tests when we are wrong; nothing
catches us outside that boundary. Four instances in one day, all external:
GitHub's "Allow GitHub Actions to create and approve pull requests" was off, so
`release-version.yml` could not open the PR it exists to open; the monolithic
`changesets/action` neither calls a `select-mode` sub-action nor picks its mode
from repository state alone; `npm publish --dry-run` was assumed to
authenticate and makes no registry call at all; and `npm access list packages
@hejbro` returned nothing, which was read as "the scope is empty" when it may
equally mean the argument form was never understood. Two of these — that
Actions setting and the `npm` environment — are **release-machinery startup
settings that live outside the workflow files**, so no amount of code review
surfaces them. List them together wherever a fork or a new preset repository
would need them.

**A new turbo task inherits nothing — give it `test`'s `dependsOn` on
purpose.** Three incidents, all the same shape: a package's tests import a
workspace dependency's built output, so they only pass where a `dist/` already
exists. #102 deleted a shared worktree's `dist`; #146 ran `pnpm --filter`,
which bypasses turbo and its `dependsOn` entirely; and `test:coverage` shipped
with no `dependsOn` at all while `test` carried `dependsOn: ["build"]` in three
separate turbo configs. Each time the claim "it runs end-to-end" was true in
the author's worktree and false on a clean clone. The same file has now misled
two readers the same way: turbo's override layout invites "read the root config
and you know the graph", and `packages/*/turbo.json` is where `dependsOn`
actually lives. **`turbo.json` means all four of them.**

The same root cause has a second face, and it caught the same person twice: a
mutation planted in one package's `src` is invisible to another package's
tests until `pnpm build` runs, because those tests import the dependency's
`dist`. Within a package it never bites — vitest transpiles the source
directly — so the habit of "edit, run, read" survives right up to the moment
it crosses a package boundary and silently measures the pre-mutation build.
A third instance landed the same day, from a different direction: a mutation
inserted at `rindex("return null;")` went into the *second* of that file's two
`return null` statements, and the run came back green. Same reading — "the
mutation didn't reproduce" — from a mutation that was never in the code path
under test. **Look at the line you planted before you read the result**; `sed
-n '103,106p'` is the whole procedure.

Both times the first reading was "the mutation didn't reproduce", which is the
worst possible failure mode for a mutation test: it says the gate is broken
when the gate is fine. **Rebuild between planting and measuring, or measure in
the package you planted in.**

**Ask "if it existed, where would it be?" before asking "does it exist?"** The
first question produces candidates and gets loud when they are wrong; the
second demands exhaustiveness and goes quiet when the search was too narrow.
`phase8-preset-goldens` was filed on a false premise — "no layer pins preset
banner text" — because the search was `grep` over `packages/core/test/golden`,
which is where core's goldens live and where a preset's never would. Asking
which layer *would plausibly* own that assertion points at
`packages/supabase/test` immediately, and `drop`'s banner turned out to have
been pinned there all along. The issue's scope shrank from "build a second
golden harness" to "add one assertion and three comments" once the premise was
measured instead of assumed.

**Record the failed runs too — and don't copy the tool's explanation for
them.** Writing down only the runs that went green is selection, not
measurement; writing down a failure with the tool's own reason attached can be
worse, because it files a wrong cause as fact. GitHub reported `This run likely
failed because of a workflow file issue`, and the workflow file's blob sha was
byte-identical across the failing run and the run 94 seconds later that
succeeded. The real cause was a repository setting changed 7 seconds earlier —
an `allowed_actions` pattern list that did not yet cover sub-directory actions.

**When the same defect returns, change the axis of the question.**
`phase8-bucket-notes` took four review rounds on one function, and the rounds
were not repetitions — each asked a question one level down. The symptom is
gone; the condition producing it was already false for an existing field, not a
future risk; the cause was not *which* sentinel was chosen (`?? false`, then
`?? null`) but that a sentinel was used at all when the top-level comparison
uses none; and removing the normalization left the same *kind* of dependency
behind, a cast resting on `JSON.stringify` silently dropping `undefined`
properties. What ended it was moving from *"is it wrong for this value?"* to
*"what is this function relying on?"*.

**A judgement is attached to content, not to a SHA.** When a branch is rebased
after review, compare the PR's own diff against each base — same files, same
`+/-` counts means the review transfers; anything else means it does not.
Measured in `phase8-bucket-notes`: `67b9670...dc0b93c` and `4b922fe...239d1c0`
produced identical six-file diffs.

**"I read it" is a claim too, and it takes the list of files.** A review of
`phase8-remove-dispatch` reported the release-procedure comments as verified
line by line; the verification covered `release-version.yml`, where the fix had
landed, and not `ci.yml`, where the sentence originally quoted as wrong still
sat. The cross-reference was in the file that had been read *first*, before the
fix, and never re-read after it. When a correction spans two files, the one
that started the complaint is the one most likely to be skipped.

**A freeze is not a promise to stop pushing — it is a claim that the SHA you
verified is the SHA that merges.** That distinction is checkable, and the
project checks it: merging with `--match-head-commit` refuses when the branch
head has moved since the declaration. It refused once, on
`phase8-remove-dispatch`, and the four lines it protected were a stale
cross-reference in a comment that the freeze declaration had claimed to have
read. So a push after a freeze — even an allowed one, even a comment-only fix —
means the declaration is void until it is re-issued against the new SHA.

The habit that makes this cheap: **declare the freeze by pasting the output of
`git rev-parse HEAD`, not by typing a SHA you remember.** A remembered SHA is a
claim about the branch; a pasted one is a reading of it. The two differ exactly
when it matters — after a push you had stopped counting as a push.

**"I recorded it" is a claim, and it takes a commit SHA.** Three times in one
day a correction existed in prose but not in the artifact: an issue whose
non-goals contradicted its own amended decision, a PR body that still called a
confirmed cause an inference, and this file's rules — reported as written while
they sat uncommitted in a stale worktree whose base was 350 lines behind `dev`.
Report the SHA, and prefer a pushed one.

**`pnpm changeset status` does not answer "does this PR need a changeset".**
Measured by reading the CLI's source: it only errors when
`releasePlan.changesets.length === 0`, so any changeset already sitting on
`dev` makes it pass regardless of what the current PR changed. Its silence was
used as evidence of "no changeset needed" at least once. The rule in AGENTS.md
is decided by looking at what the PR changed, not by that command's exit code.

**Does this change make a currently-true document false?** If it does, fixing
that text is part of the PR, not a follow-up.

This phase met the same defect class three times, which is why it is a rule
rather than a reminder:

- `snapshot.ts`'s version-mismatch message hard-codes "hejbro is
  pre-publication" and tells the user to delete the snapshot — after which
  `verify` tells them to restore it from version control (#136).
- `table-kind-emit.ts` refuses two column alters "in Phase 1", exposing an
  internal roadmap number to users. Those two strings disappear with
  #24, but only because that work removes the throw sites.
- `packages/supabase/README.md`'s D45 paragraph tells users to wrap
  `auth.uid()` themselves "until then". `phase8-authuid-cached` is *then*, and
  leaving the paragraph in place would publish advice for a workaround that is
  no longer needed.

The pattern is always the same: text that was true when written, made false by
a later change, and left behind because nobody owned it. The PR that falsifies
it owns it.

**And one rule for writing them: name the mechanism, then check its
range.** A completion criterion that points at a gate is only as good as
what that gate actually looks at.

This phase got it wrong twice in the same way. The image pin was first
recorded in a comment — a comment is not a check, so it was upgraded to a
digest comparison that fails. Then the expression-naming criterion pointed
at `naming-conventions.test.ts` and forbade carve-outs — but that test
inspects a closed list of tokens, so `constantOne` could have landed in a
v5 snapshot and stayed green. Forbidding a carve-out was never the
problem; there was nothing to carve out of.

So when a criterion says "X enforces this", open X and confirm it sees the
thing. If it does not, extending it is part of the PR — and the extension
lands **first, failing**, so its reach is proven before the code that
needs it.

**And when the criterion is a `grep`, it matches a spelling, not an
intent.** `phase8-policy-predicates`'s definition of done was
`git grep -c 'isNotNull(t.id)' examples/` = 50, which sounds like "every
workaround is gone" and actually means "every workaround *on a column named
`id`* is gone". `task_schedules` is a 1:1 table whose primary key is
`taskId`, so its six sites carry the identical comment — *"hejbro has no
literal `true` helper yet — see #113"* — and the criterion could not see
them. Passing it would have shipped a comment pointing at a closed issue,
in the PR that closed it.

What the six sites had in common was not the expression but the comment,
and the comment is the marker of intent. **Prefer a criterion that matches
why the code is there over one that matches how it happens to be written**
— the "how" changes for reasons that have nothing to do with the work.

**But say which unit you are counting.** The corrected criterion counts two
different things, and the first two attempts at writing it down — the
issue's and then this file's — both attached the wrong number to the wrong
`grep`:

```
git grep -c 'see #113'   examples/   →  34   marked policy blocks
git grep -c 'isNotNull(t.' examples/ →  56   workaround expressions
```

A block carries one comment and usually two expressions (`using` and
`withCheck`), so neither count is a subset of the other and neither alone
proves the work is finished. **Done is both at 0, with the per-file
distribution reported** — a matching total with a wrong distribution means
one chain step was skipped.

This one is worth separating from the measurement failures above it,
because it is a different thing going wrong. Those were cases where a
measurement was narrower than the claim it was used to support. This is a
case where **the definition of "done" was narrower than done** — the work
could satisfy the criterion completely and still be unfinished. A
completion criterion is an instrument, and it needs its range checked
before the work starts, not after.

It was caught because the implementer checked the example scope *before*
starting the core change rather than after finishing it. Had the order been
reversed, the six sites would have surfaced during the mechanical
replacement pass, when the count is a thing to reconcile rather than a
thing to question.

**Before measuring CLI behaviour, confirm `dist` is newer than the source
you changed.** `test/golden.test.ts` and the other spawn-the-built-CLI
suites validate `dist/cli.js`, and `assertBuiltCli` checks only that it
exists. Root `pnpm test` goes through turbo and rebuilds first;
`pnpm --filter hejbro test` does not. This applies to every PR that
measures the CLI by spawning it — `phase8-loader-diagnostics`,
`phase8-flag-equals`, and the format wave. See "a failed reproduction is
not evidence of absence" below for what this looks like when missed.

**A workflow that runs on more than one event must be measured on each of
them.** The `git fetch origin dev:dev` step added in `phase8-changesets` was
verified on `pull_request` — where it was genuinely needed and genuinely
worked — and shipped without ever running on `push`, where the branch it
fetches into is already checked out and git refuses with exit 128. Four
merges landed on a red `dev` before anyone looked: the PR checks were green,
and a PR check and a branch build are *different events*. Verifying a
workflow on the event you happened to be debugging is not verifying the
workflow. The fix first proposed for it was scoped to the wrong axis —
`event_name == 'pull_request'` instead of the condition that stood for
(*is a local `dev` branch missing?*) — which would have moved the
failure to the `main` push that triggers a release rather than removing
it. A requirement can be wrong in a fourth way: right premise, real
measurement, wrong proxy variable.

**How to check a gate's range: break it on purpose.** Reading a gate and
judging whether it covers something is weaker than injecting the defect
and watching it fail. `phase8-packaging`'s review did exactly that — seven
defects injected into the pack-install smoke: five caught, one missed
(`@hejbro/supabase`'s `exports` was never loaded, so breaking it changed
nothing), and one caught by a different mechanism than the script claimed
(`npm install` rejects a `workspace:` string in `dependencies` before the
assertion that supposedly guards it ever runs). Neither the gap nor the
misattribution was visible from reading the script. So: a PR that builds
or extends a verification device shows the same evidence — the defects it
exists to catch, injected one at a time, each turning it red.

This applies to configuration too — and to the causal claims made about it.
`updateInternalDependencies` went through two readings in this phase, both
grounded in something real and **neither established**: the first concluded
"no-op" from the range form alone, without running anything — the conclusion
happened to hold, but nothing had tested it. The second ran `changeset
version` on a copy (`phase8-changesets`), saw a dependent bump, and
attributed it to the setting — without ever changing the setting itself.
**Vary the thing you are attributing the effect to.** A variable you did not
vary cannot be the cause. Measured across eleven combinations of the key's
value (`patch` / `minor` / removed), the dependency's own bump type, and its
declared range — not a full cross (`3 × 2 × 3 = 18`), a selected sample of
eleven — the bump was identical every time: changesets bumps a dependent by
default when its internal dependency releases, and this field changes
nothing observable in this repo. A config key is a gate like any other — run
it before describing what it does, and change the specific thing you're
crediting before crediting it.

The two are not the same rule. **"Vary what you credit" applies to a causal
claim** — you saw an effect and named a cause. **"A green proves nothing"
applies to a requirement or an observation** — you saw nothing and concluded
there was nothing to see. This phase produced both: the
`updateInternalDependencies` write-up above is the first, the "`changeset
status` enforces nothing" premise below is the second.

**A green proves nothing unless the defect was actually present.** The
converse of "break it on purpose": before concluding a gate doesn't catch
something, confirm the thing it was supposed to catch was actually there to
catch — the same discipline as varying the variable you credit, aimed at the
opposite failure. This phase concluded `changeset status` "enforces nothing"
from a measurement where only the changeset was removed and the package
itself was left unchanged — the gate had nothing to catch, so its green
proved nothing about its range. A negative result is more dangerous than a
positive one here: a red gate is evidence something happened, but a green
gate does not distinguish "didn't catch it" from "nothing to catch."

**A failed reproduction is not evidence of absence.** When one measurement
contradicts another, the answer is not to pick the more recent or the more
senior one — it is to find the variable that differs. In
`phase8-error-subclass` a review reported that restoring the object spread
failed *nine* golden tests; a re-measurement found the whole suite green and
concluded the defect was silent; a third, controlled run reproduced all
nine. The variable neither re-measurement controlled was **build
freshness**. `test/golden.test.ts` drives the built `dist/cli.js` as a
child process and `assertBuiltCli` checks only that the file *exists*,
not that it is current. Under `turbo` that is harmless —
`packages/cli/turbo.json` declares `test: { dependsOn: ["build"] }`, so
`pnpm test` rebuilds first. **`pnpm --filter hejbro test` bypasses turbo
entirely**, running the package's `vitest` script directly, and the
`dependsOn` never applies: source edits are then measured against the
previous artifact. The trap is not the task graph but the choice of entry
point. A reproduction that fails is a signal to re-examine the
*procedure*, not a verdict on the defect.

Two people confirmed the wrong conclusion before the third measured it: the
review's supporting claim (*"the golden suite's only error assertions are
ambiguity errors"*) was checked with `grep "error\["`, which matches only
the assertions that spell the code literally — the nine that assert the
message body were outside the instrument's range. **Naming the mechanism
and then checking its range** is the rule already written above; it failed
here because the check *looked* like a measurement.

The same failure recurred while diagnosing itself: the mechanism first
offered for the stale artifact — *"turbo declares no `dependsOn`"* — was
read off the **root** `turbo.json` alone, missing the package-level
`packages/cli/turbo.json` that overrides it. Twice in one review an
instrument too narrow for the claim produced a confident wrong answer.

**When two of your own measurements disagree, one of them is invalid —
find which, before explaining why both could be true.** In this review one
session produced both *"the suite is green, so nothing catches this"* and
*"the rebuilt CLI prints `undefined`, so the defect is real"*, and instead
of treating the pair as a contradiction to resolve, it produced an
explanation for how both could hold (*"the tests bypass that path"*) —
which then read as verified because a narrow instrument agreed with it. A
reconciling explanation is almost always available, and inventing one
feels like discovering it.

**Don't conclude "nothing catches this" from one gate.** Twice in this phase
a requirement was written on the premise that a defect would pass silently —
a shrinking chain, a misread rename — and both times another gate already
caught it (`chain.test.ts`'s static imports and its `confirmedDropsForStep`,
`cli.test.ts`'s count). The claim *"this is silent"* is itself a measurement,
not an observation.

A third instance in the same review differed in one way that mattered: the
premise (a known-ambiguity list to guard against a silently-misread rename)
was questioned *before* the requirement was written, so it cost a question
instead of an implementation round — the first two were discovered only
after the code already existed, once someone went looking for what else
might already cover them. **Order is the whole difference.** A premise
checked before the requirement is written costs asking; a premise checked
after costs building, reviewing, and unwinding.

**A guard must read its baseline from something it cannot itself change.**
`phase8-regen-script`'s shrink guard counted the committed migrations from
the working tree, then exited after the script had already shrunk that
tree — so a second run compared the reduced state against itself and
passed. The first thing anyone does after a failing script is run it
again. `git ls-files` reads the index, which the script never touches;
that is what the baseline needed to be. This is a third, distinct failure
from the two above — neither "check its range" (the guard's scope was
correct: it looked at exactly the right count) nor "a green proves
nothing" (the defect it existed to catch was genuinely present) explains
it. The question this one asks is whether the thing a guard reads *can be
changed by the guard itself* — a green here isn't wrong because the gate
saw too little or because nothing was there to catch; it's wrong because
what it read had already been rewritten by the time it read it.

**Mutate the producer, not the artifact.** A `prepack` or regeneration step
will silently heal an artifact-level mutation, and the gate passes for the
wrong reason. `phase8-packaging` hit this while verifying its own `.d.ts`
assertion: deleting `dist/cli.d.ts` before packing didn't turn the assertion
red, because `prepack: "pnpm build"` rebuilds `dist` — including the deleted
file — as part of every `pnpm pack`. The assertion only actually fired once
the *producer* was changed instead (tsdown's config set to `dts: false`, so
no `.d.ts` is emitted at all). The mutation has to target whatever produces
the artifact — the build step, the source it builds from, or the config that
drives it — not the artifact itself once it exists.

This rule came from the same review: deleting `dist/cli.d.ts` did not turn
the smoke red, because `prepack` rebuilds `dist` during `pnpm pack`. The gate
was fine; the mutation was healed before it could be seen. Two of the
mutation scenarios written into this plan had the same flaw and were
rewritten above (`phase8-release-workflows`'s stale-`dist` case and
`phase8-expr-nodes`'s snapshot-planting case) — the standard was written
before its own trap was known, which is worth keeping on record rather than
quietly fixing.

## Settled: expression discriminators in the snapshot (D70)

D57 exempts one thing explicitly: *"internal expression/statement AST
discriminators are out of scope entirely (**they never reach an artifact**)"*.
D67 removes the condition that exemption rests on — once expressions are stored
structurally, those discriminators are written into the snapshot, which is an
artifact.

Seven of the thirteen `ExprNode` discriminators are camelCase (`columnRef`,
`functionCall`, `inList`, `nullTest`, `plpgsqlRef`, `rawSql`, `sqlTemplate`),
and `TableRefNode` carries `schemaName`/`tableName` where D57's snapshot
vocabulary asks for `schema`/`table`.

**D70 settles it by applying D57 rather than amending it**: the serialized form
is kebab-case with D57's reference vocabulary, the TypeScript union stays
camelCase, and the mapping lives in the expression codec. D70 is written as a
rule over the whole serialized subtree rather than a list of nodes, because the
subtree is wider than `ExprNode`: `exists(...)` pulls a `SelectNode` in with
it, which is how `projectionKind: "constantOne"` reaches a snapshot — two of
the three policies in `examples/supabase` already take that path. One limit on
"every discriminator": `operator` and `direction` values (`not like`, `ilike`,
`asc`, …) are SQL's own tokens rather than hejbro vocabulary, so they are
stored verbatim — kebab-casing `not like` would produce SQL Postgres does not
accept. D57 draws the same line for user-supplied SQL identifiers (D36).
`packages/core/test/naming-conventions.test.ts` scans generated output rather
than source — by design — so it is the enforcement mechanism, not an obstacle
to work around.

## Design input needed before `phase8-authuid-cached`

The cached `authUid()` variant is a public API surface decision: the export's
name, and — more importantly — **which form the skill and the README teach as
the default**, since that becomes what every agent-written policy looks like.
Route this through a design pass before implementation, against D57's naming
rules (TypeScript-only API stays camelCase) and §7's diagnostic grammar.

## Verifications that land with the code

These are documented-behaviour claims the brainstorm did not execute. Each is
settled by the first failing test of the PR that depends on it — none of them
blocks starting.

| Claim | Settled by |
|---|---|
| `alter table … add primary key (cols)` is valid without a constraint name | `phase8-constraint-names` chain step (real Postgres) |
| Dropping one column of a composite primary key drops the whole constraint | `phase8-constraint-names` chain step (real Postgres) |
| `alter column … type serial` is rejected by Postgres | `phase8-sequence-kind` |
| A new `ExprNode` kind reaches `assertNever` in an older build | `phase8-expr-nodes` |
| #87's user-facing count (~75, ±5) and its zero golden impact | `phase8-next-marker`'s first commit |
| #132's 62 lint findings | 0.2.0, when the rule is designed |

One note for whoever picks up #132: `biome check` fails with "configuration
resulted in errors" in a fresh worktree that has not run `pnpm install`. That
is a missing `node_modules`, not a broken `biome.json` — install first, then
measure.

## Owner actions

**Before the first release**

1. Create an npm **automation** token (not a publish token — a publish token
   prompts for 2FA and fails in CI) and add it as the `NPM_TOKEN` secret on
   `quickstart-now/hejbro`.
2. Confirm the `@hejbro` scope is registered to the owner account. This cannot
   be checked from the repository: `npm view @hejbro/core` returning 404 only
   means the package does not exist.
3. Decide what happens to the local `NPM_TOKEN` rule in the private
   owner-workflow notes, which assumes publishing from a laptop.

**After the first release (#139)** — for each of `@hejbro/core`, `hejbro` and
`@hejbro/supabase`: package **Settings → Trusted Publisher → GitHub Actions**,
organization `quickstart-now`, repository `hejbro`, workflow filename
`release-publish.yml` (the file name, not a path), environment blank, and
**check `npm publish` under allowed actions**. Then `NODE_AUTH_TOKEN` can be
dropped from the workflow.

## Out of scope

Deferred to 0.2.0 with a reason: **#130** (new commands; four design questions
open; the manual rollback procedure in `docs/guide/renames.md` is complete once
#129 lands), **#131** (internal tooling; the release path already builds from a
clean install), **#132** (needs a per-path lint design first), **#139**
(blocked until the packages exist), **#141** (`design: core has no notion of
which clause an expression sits in`, split off during #97's design pass —
needs a brainstorm on whether a clause taxonomy belongs in core's extension
interface).

**#139** and **#141** stay as sub-issues of **#9**. There is no Phase 9 — the
owner decided (2026-08-21) that Phase 8 is the last phase and what follows
0.1.0 is release work, not a numbered phase. So "deferred to 0.2.0" is a
milestone, not a parent: both keep #9 as their parent issue so they remain
findable, and neither blocks the 0.1.0 release.

Still unscheduled: the GitHub Pages site (D64).
