# Phase 8 — Release readiness: Implementation Plan

Brainstorm resolved 2026-08-21 (owner-approved): decision log entries
**D58–D68**, plus an in-place amendment to **D33**. This plan turns those
decisions into 23 PRs, plus D69 and D70, added at plan review.

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
format change costs nothing there.

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
| 5 | `phase8-release-workflows` | `release-version.yml` (on `dev`, version only) and `release-publish.yml` (on `main`, publish only), `NPM_CONFIG_PROVENANCE`, `id-token: write`, and the pre-publish gate (`check`/`check-types`/`test`/`build` + the #86 smoke) | — |
| 6 | `phase8-error-subclass` | `HejbroError` becomes an `Error` subclass; both duck-typing sites (`commands/generate.ts`, `commands/verify.ts`) switch to `instanceof` | #25 |
| 7 | `phase8-loader-diagnostics` | Declaration/config load failures become diagnostics instead of a raw `TypeError` | #125 |
| 8 | `phase8-chain-walk` | `verify` accepts a chain that returns to an earlier snapshot state | #129 |
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
| 19 | `phase8-policy-predicates` | RLS predicate widening; the showcase drops `using(isNotNull(t.id))` | #113 |
| 20 | `phase8-bucket-notes` | Field-level notes for bucket alters; empty note lists stop rendering `[]` | #116 |
| 21 | `phase8-authuid-cached` | `authUid()`'s cached variant (reusing the existing `rawSql` node) and the three places that teach the uncached form | #97 |
| 22 | `phase8-supabase-image` | `scripts/verify-supabase-image.sh` — the preset checked against a real `supabase/postgres` image (D69) | — |
| 23 | `phase8-docs-release` | README status and install instructions, `CONTRIBUTING.md`, then the 0.1.0 release | — |

`phase8-pk-guard` lands **before** `phase8-constraint-names` in dependency
terms but is listed after it for readability: the guard is a small, independent
PR that can go as early as the diagnostics wave, and `phase8-constraint-names`
then replaces it with real SQL.

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

## Two rules that apply to every PR

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
workflow.

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

**#139** and **#141** are filed as sub-issues of **#9** only because no Phase 9
issue exists yet — move them under Phase 9's issue once it's created, or a
later reader won't find them there.

Still unscheduled: the GitHub Pages site (D64).
