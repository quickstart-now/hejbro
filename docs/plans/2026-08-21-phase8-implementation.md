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
  landed (D59). PRs before that do not.
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
  `phase8-release-workflows` closes this gap; see its row below.
- **`phase8-changesets`** — `changeset status` runs clean; a dry version run
  bumps the three packages together. Document in `CONTRIBUTING.md` that the
  **first release needs a `minor` changeset**, since an all-`patch` set would
  publish `0.0.1`.
- **`phase8-regen-script`** — running the script reproduces the committed
  example migrations and snapshots **byte for byte** before any format change.
  That is the script's own test.
- **`phase8-release-workflows`** — the workflows are validated against
  `changesets/action`'s `action.yml` (input names differ between versions; do
  not copy a draft blindly). The publish job must refuse to run if the
  pre-publish gate fails. It must also close the gap `phase8-packaging`'s
  smoke left open: that smoke proves a `pnpm`-packed tarball installs
  cleanly, not that the real release actually packs with `pnpm`. `changeset
  publish`'s choice of `pnpm publish` for this workspace is automatic
  detection (D59/D63), not a pinned setting — this PR needs a check, at
  publish time, of which tool actually packed (e.g. inspecting the published
  tarball's own `package.json` for a leftover `workspace:` string before it
  reaches the registry), so a detection change or a future workflow edit that
  swaps in `npm publish` fails loudly instead of silently shipping the
  `EUNSUPPORTEDPROTOCOL` tarball `phase8-packaging` reproduced and rejected.
- **`phase8-error-subclass` → `phase8-loader-diagnostics`** — a test
  reproducing #125's crash (a config importing a package that is not installed)
  first, then the diagnostic. Both `asHejbroError` sites are converted.
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
  every reference key, then make it green.
- **`phase8-sequence-kind`** — the invalid `alter column … type serial` path is
  closed; a column rename and a table rename both keep the sequence in step;
  `serial()` → `integer()` emits the default drop and the sequence drop.
- **`phase8-constraint-names`** — pk/unique changes emit drop + add using names
  taken from the snapshot; #137's add and drop paths are covered by tests, and
  the chain step added in this PR exercises them under real Postgres.
- **`phase8-pk-guard`** — a PK column added to an existing table is refused
  loudly rather than emitted without its constraint.
- **`phase8-grant-sync`** — a table added under a schema-wide grant reaches the
  grant; `pnpm --filter example-postgres roundtrip` produces an empty diff.
- **`phase8-authuid-cached`** — the skill reference, the README paragraph and
  the three example policies all move to the cached form. **The README's D45
  paragraph currently tells users to wrap the call themselves "until then";
  that text becomes false and must be rewritten** — the same class of defect as
  #136.
- **`phase8-supabase-image`** — see the section below.
- **`phase8-docs-release`** — README's `## Status` no longer says "Nothing is
  published yet"; install instructions exist; `CONTRIBUTING.md` states plainly
  that merging the version PR publishes immediately and that npm burns a
  version number even if it is unpublished.

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
