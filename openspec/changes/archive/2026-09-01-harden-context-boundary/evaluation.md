# D106 Isolated Spec-Only Evaluation — harden-context-boundary

| | |
|---|---|
| Change id | `harden-context-boundary` (#561) |
| Squashed dev sha | `16e1c926` — feat(query): refuse empty context renderings and name surfaces (#592) |
| Evaluator model | fable |
| Start (export birth) | 2026-08-31T16:13:45Z (machine-local 2026-09-01T01:13:44) |
| End | 2026-08-31T16:32:19Z (evidence complete 16:29:53Z; report written after the export-unchanged proof, outside the export) |
| Export root | `…/scratchpad/d106-context-boundary` (no `.git`; `proposal.md`, `tasks.md`, `blackbox/`, `docs/`, `openspec/changes/archive/`, `task-times.csv` intentionally absent) |

**Verdict: PASS — 0 BLOCKING / 1 MAJOR / 3 MINOR.** The one MAJOR (F1)
is a delta-scenario over-quantification falsified by the shipped Nile
driver; it is repairable with a one-clause WHEN narrowing in the delta
text before archive. Shipped *behavior* is fail-closed and internally
consistent on every cell I could reach.

## Integrity disclosure

- Every file read for judgment came from the export directory. No main
  checkout, worktree, `~/.claude`, `gh`, or `openspec` CLI use.
- The evaluation harness resets the shell cwd to the main checkout
  between commands; every command either `cd`-ed into the export first
  or operated on `/tmp` scratch files. No file outside the export was
  read or written except: (a) `/tmp/d106-{pre,post}-hash.txt` and
  `/tmp/d106-{main,delta}-*.txt` (my own extraction/hash scratch), and
  (b) this report.
- `pnpm install --frozen-lockfile --prefer-offline` is the one
  sanctioned network-capable step (registry resolution per its own
  cache policy). No other network access.
- One probe file was created at the single permitted path
  `packages/query/test/d106-probes.test.ts` (292 lines, 42 tests) and
  **deleted before the export-unchanged proof**. Export content hash
  (all files, `node_modules`/`dist`/`.turbo` excluded) before and
  after the entire evaluation:
  `d4606687871c47d0d54424a38db7eb266719a3af3f6b1feddfe6f7053a5a5635`
  = `d4606687…5635` — **identical** (`diff` of the two hash files:
  empty, `EXPORT-UNCHANGED`).
- The ambient session context (system prompt / memory) carries general
  repository knowledge; all judgments below cite export files only.
- Other contact outside the permitted set: none.

## Method

Delta-vs-main byte comparison (per modified requirement, `awk`-extracted
blocks, then `diff`):

```
extract() { awk -v req="$2" 'BEGIN{p=0} /^### Requirement: /{p=($0=="### Requirement: " req)} p' "$1"; }
diff /tmp/d106-main-role.txt      /tmp/d106-delta-role.txt       # exit=1: pure insertion 21a22,27 (one paragraph)
diff /tmp/d106-main-misscap.txt   /tmp/d106-delta-misscap.txt    # exit=1: insertions 6a7,16 + 12a23,29
diff /tmp/d106-main-mandatory.txt /tmp/d106-delta-mandatory.txt  # exit=1: insertions 16a17,53 + 51a89,116
diff /tmp/d106-main-rendering.txt /tmp/d106-delta-rendering.txt  # exit=1: insertions 34a35,44 + 72a83,88
```

Every diff hunk is an `a`-only (append) hunk: **all pre-existing
paragraph and scenario text, titles, and order are preserved
byte-identically.** Scenario counts: role-whitelist 4→4 (+1 paragraph),
mandatory-context 5→9, missing-capability 1→2, context-rendering 6→7 —
exactly the MODIFIED-2/MODIFIED-2 shape claimed.

Gates (all inside the export):

```
pnpm install --frozen-lockfile --prefer-offline        # exit 0 ("Done in 2.9s"; hejbro bin warnings pre-build, expected)
TURBO_FORCE=1 pnpm build        # "Tasks: 7 successful, 7 total / Cached: 0 cached, 7 total"     exit 0
TURBO_FORCE=1 pnpm check-types  # "Tasks: 16 successful, 16 total / Cached: 0 cached, 16 total"  exit 0
pnpm check                      # "Checked 560 files in 494ms. No fixes applied."                exit 0
TURBO_FORCE=1 pnpm test         # exit 1 — sole failing task @hejbro/skills#test
TURBO_FORCE=1 pnpm turbo run test --filter='!@hejbro/skills'
                                # "Tasks: 16 successful, 16 total / Cached: 0 cached, 16 total"  exit 0
```

The `@hejbro/skills` failure is `test/links.test.ts` ("every
backticked/linked repo path in skills/hejbro resolves on disk")
reporting exactly `docs/guide/getting-started.md`,
`docs/specs/2026-08-19-hejbro-design.md`, `docs/guide/indexes.md`,
`openspec/changes/archive/2026-08-31-extend-query-runtime/measurement.md`
— all four are paths the **export protocol itself stripped** (`ls docs`
→ "No such file or directory"; `openspec/changes/` contains only
`harden-context-boundary`). Not attributable to the change; every other
package passes with `0 cached`.

Probes: single permitted file, run via
`cd packages/query && pnpm exec vitest run test/d106-probes.test.ts`
→ **"Test Files 1 passed (1) / Tests 42 passed (42)"**, then deleted.

## Probe table

| # | Probe (driver config → invocation) | Observation (verbatim assertion targets) | Verdict vs delta |
|---|---|---|---|
| P1 | `contextRequired:true, renderContext:()=>[]`; `db.as({role:grant_reader}).execute(select)` | rejects `{code:"context-rendering-empty", operation:"db.execute"}`; `driver.transaction` called ×1; `sentPerTransaction == [[]]` | "A context whose rendering produces nothing is refused" ✓ (code, no caller statement, opened transaction carries none) |
| P2a | `contextRequired:true, roleLessPlatform:true` (no contribution → default rendering); `db.as({}).execute` | rejects `{code:"context-rendering-empty"}` | "A context carrying nothing does not satisfy the declaration" ✓ on the default-rendering instantiation |
| P2b | **shipped `nileDriver(base)`** — asserted `contextRequired===true`, `roleLessPlatform===true`; `db.as({}).execute` | error code === `"nile-context-value-invalid"`; `!== "context-rendering-empty"`; `sentPerTransaction == [[]]` | **✗ falsifies the same scenario's THEN on a shipped driver satisfying its WHEN** → F1 |
| P3 | `roleLessPlatform:true` only (no `contextRequired`), with `renderContext:()=>[]` and separately default rendering; `db.as({}).execute` | resolves; per-transaction statements `length===1` (caller's only), no refusal | "A driver that requires no context keeps applying nothing" ✓ (both rendering variants) |
| P4 | `contextRequired:true`, plain handle, all 8 surfaces (`execute/select/insert/update/deleteFrom/with/fn/transaction`) | each rejects `code:"context-required"` with `operation` = `db.execute / db.select / db.insert / db.update / db.deleteFrom / db.with / db.fn / transaction`; driver never called | "A refusal names the surface the caller invoked" ✓; two chain members distinct ✓; transaction keeps `transaction` per the stated exception ✓ |
| P5a | `contextRequired:true, renderContext:()=>[]`, **scoped path**, all 8 surfaces | each rejects `code:"context-rendering-empty"` with the same 8 per-surface tokens | naming "on the explicitly scoped path" ✓ |
| P5b | same driver, **provider path** (`db(schema, driver, {context})`), all 8 surfaces | each rejects `code:"context-rendering-empty"` with the same 8 tokens; every opened transaction carries zero statements | naming "and the provider path alike" ✓ |
| P6 | `interactiveTransactions:false`, scoped path, all 8 surfaces | each rejects `{code:"driver-missing-capability", capability:"interactive-transactions"}` with the same 8 per-surface tokens (transaction → `transaction`) | driver-contract "The refusal names the surface the caller invoked" ✓ for execute/chain/fn; transaction token has no stated exception in *that* requirement → F2 |
| P7 | `contextRequired:true`, rendering returns one Proxy statement whose every property `get` throws | execution succeeds; session executed 2 statements (poison forwarded opaquely, then caller's) | "from the number of statements returned … none of them inspected or rewritten" ✓ (counts `length`, reads nothing) |
| P8 | undeclared role on the empty-rendering mandatory driver; `db.as({role:never_declared})` | throws synchronously `code:"undeclared-role"`; no transaction opened | role-whitelist runs first; new paragraph's "admission by this check is not admission by every check" ordering ✓ |
| P9 | shipped Nile; whitelisted role in context; `db.as({role:grant_reader}).execute` | rejects `{code:"nile-context-unsupported", field:"role"}`; transaction carries none | main-spec Nile scenario "A context naming a role is refused, not dropped" still holds after the new guard ✓ (rendering's refusal precedes the empty-count check) |
| P10 | `contextRequired:true`; `handle.driver.execute({sql:"select 1"…})` | resolves; 1 top-level statement sent | "Non-execution members are unaffected" ✓ |

Shipped tests independently cover P1/P2a/P4/P7/P10
(`packages/query/test/db/context-required.test.ts:185–361`), the
missing-capability tokens on scoped and provider paths
(`context.test.ts:541–559`, `context-provider.test.ts:346–364`), the
Neon one-shot boundary with `operation:"db.execute"`
(`packages/neon/test/driver.test.ts:353–406`), and P2b's Nile behavior
(`packages/nile/test/context.test.ts:303–325` — the implementers
themselves pin `nile-context-value-invalid` for `db.as({})`).

## Universal quantification table

Path × surface × driver, for each refusal family. "✓P*" = executed
probe; "✓T" = shipped test read; "struct" = structurally unreachable
(and correctly so); "—" = no refusal expected, confirmed proceeding.

**`context-required`** (fires only on the plain, no-provider path — a
scoped handle has a context by construction; a provider path always
resolves one or fails with its own codes):

| Surface | plain × contextRequired | scoped | provider |
|---|---|---|---|
| execute | ✓P4 `db.execute` | struct | struct |
| select/insert/update/deleteFrom/with | ✓P4 per-verb tokens | struct | struct |
| fn | ✓P4 `db.fn` | struct | struct |
| transaction | ✓P4 `transaction` | struct | struct |
| `driver` member / assertSchema path | — ✓P10 | — | — ✓T (`context-provider.test.ts:366`) |

**`context-rendering-empty`** (needs a context in hand + mandatory
declaration + rendering-in-effect returning zero statements):

| Surface | scoped × empty contribution | provider × empty contribution | scoped × default rendering, empty context (role-less) | Nile (own rendering) |
|---|---|---|---|---|
| execute | ✓P1/P5a | ✓P5b | ✓P2a | **unreachable — rendering throws first** (`nile-context-value-invalid` ✓P2b / `nile-context-unsupported` ✓P9) → F1 |
| chain ×5 | ✓P5a | ✓P5b | (same mechanism, one `applyContext` seam) | unreachable, same |
| fn | ✓P5a | ✓P5b | (same seam) | unreachable, same |
| transaction | ✓P5a `transaction` | ✓P5b `transaction` | (same seam) | unreachable, same |
| non-mandatory driver, any empty rendering | — ✓P3 (proceeds, nothing sent) | | | |

The refusal is one seam (`applyContext`, `packages/query/src/db/context.ts:227-231`),
shared by `createAsApi.scopedRun` and `createProviderRun` — the two
paths cannot diverge per surface, which is why the per-cell probes all
land identically. No plausible in-repo implementation makes a satisfied
cell false, **except** the Nile column, where the falsifier ships (F1).

**`driver-missing-capability`** (context paths on a
non-transactional driver): scoped ×8 ✓P6; provider ×3 ✓T; Neon HTTP
scoped-execute ✓T with `operation:"db.execute"` distinguishing the
query layer's gate from the driver's own `transaction`-token thrower.

Counting sentences audited: "That covers both refusals this
requirement raises" — exactly 2 codes raised by the mandatory-context
requirement (`context-required`, `context-rendering-empty`) ✓;
"exactly the two named capabilities" — `DriverCapabilityKey` is a
2-member union (`contract.ts:55`) and the rendering/role/mandatory
declarations are non-capability optional members ✓.

## Three-way comparison (delta ↔ shipped code/tests ↔ user contract)

Forward (every new normative element → where it lands):

| Delta element | Implementation | Tests | Skill / changeset |
|---|---|---|---|
| Empty-rendering refusal, code `context-rendering-empty`, after rendering / before caller statement, opened transaction carries none | `context.ts:99-106,227-231` | `context-required.test.ts:185-211` + P1 | `query-layer.md:767-772,1060,1100-1104,1121-1128`; changeset ¶1 |
| Count-only, never inspect/rewrite | `statements.length` only | poison proxy `:236-269` + P7 | `query-layer.md:1060` ("from the number of statements it returned alone, never from reading them") |
| Non-mandatory + empty rendering unchanged | same guard condition (`&& contextRequired === true`) | `:225-234` + P3 | `query-layer.md:1126-1128` |
| Per-surface `operation` on `context-required` / `context-rendering-empty`, scoped & provider alike, `transaction` excepted | `db.ts:355-377`, `chain.ts:84,887-937` (`ChainRunFactory`), `context.ts` operation threading, `transaction.ts:355` | `:272-361` + P4/P5a/P5b | changeset ¶2 (token list + exception); `query-layer.md:1059-1060` |
| Per-surface `operation` on `driver-missing-capability` | `assertCapability` call sites (`context.ts:267,319`, `transaction.ts:331`) | `context.test.ts:541-559`, `context-provider.test.ts:346-364`, neon `driver.test.ts:397` + P6 | `query-layer.md:1052` (incl. the `transaction` exception the spec omits — F2) |
| Role-whitelist ¶3 (admission ≠ admission by every check) | `assertContextRole` before `applyContext` | P8/P1 ordering | — (internal sequencing; no user claim) |
| Rendering-contribution ¶5 (empty result → refuse iff mandatory) | same seam | driver-contract delta scenario ≡ rls scenario, one implementation | `query-layer.md:1100-1104` |

Reverse (shipped observable changes → spec coverage): the two new
behaviors (`context-rendering-empty`; `operation` tokens) are both
specced by the deltas; the `.changeset/harden-context-boundary.md`
names `@hejbro/query` `minor` (fixed group — sufficient per the
config); the skill was updated in the same shipment (error table rows
for both codes present); no shipped behavior change found outside the
delta's claims. The Nile test addition
(`context.test.ts:303-325`) documents a *pre-emption* of the new
refusal that the delta text does not acknowledge — that is F1's
substance, and the skill's own careful wording ("a **default-rendered**
context that carries neither role nor setting", `query-layer.md:1123`)
shows the narrower, correct claim already exists in the user contract.

Cross-capability cites verified against their source text:
- `diagnostics` ("the identity `diagnostics` makes machine-readable,
  message prose being free to move") ↔ `openspec/specs/diagnostics/spec.md:16-18`
  ("The code is the machine-readable identity: it SHALL stay stable …
  message prose MAY change") ✓ — which is also why F1's wrong-code
  claim matters: consumers are told to branch on the code alone.
- rls delta's transaction-token rationale ("the contract requires the
  two to match") ↔ driver-contract delta ("Where a driver raises the
  failure for its own member, the operation SHALL be that member's
  name") + main "The missing-capability error has one definition" ✓.
- rls delta's rendering-empty ↔ driver-contract delta's "as the
  mandatory-context requirement states" — the two describe one seam,
  consistently ✓.

## Findings

**F1 — MAJOR.**
`openspec/changes/harden-context-boundary/specs/rls-execution-context/spec.md:155-160`
(scenario "A context carrying nothing does not satisfy the
declaration"). The WHEN — "a context that carries neither a role nor a
setting, on a driver that declares both a mandatory context and a
role-less platform" — is satisfied by the shipped Nile driver
(`packages/nile/src/driver.ts:24-29` declares exactly both), but the
THEN's promised code is falsified there: `db.as({})` on Nile is refused
with `nile-context-value-invalid` (rendering throws on the absent→""
tenant value, `packages/nile/src/context.ts:137-146`), never
`context-rendering-empty` — executed probe P2b, and pinned by the
package's own test (`packages/nile/test/context.test.ts:303-325`,
titled "the preset never reaches the query layer's own empty-rendering
refusal"). The requirement paragraph itself is correctly conditioned
("Where the rendering produces none…"); only the scenario drops the
condition, and the sibling scenario ("A context whose rendering
produces nothing is refused") shows the authors do pin the rendering
when they mean to. The skill already states the narrow, true claim
(`query-layer.md:1121-1124`: "a **default-rendered** context…"). The
fail-closed *outcome* holds on every instantiation (refused either way,
transaction carries none — P2b), so this is a spec-text defect, not a
behavior defect. **Prescription:** before archive, narrow the WHEN by
one clause — e.g. "…on a driver that declares both a mandatory context
and a role-less platform **and whose rendering in effect returns no
statement for it**" (or "…that contributes no rendering") — mirroring
the requirement's own conditional; optionally add a cross-reference
that a contributed rendering may refuse such a context earlier with its
own code (Nile does).

**F2 — MINOR.**
`openspec/changes/harden-context-boundary/specs/driver-contract/spec.md:11-19`
(modified "Missing capability is an explicit error"). The added
obligation — "the operation it names SHALL be the surface the caller
invoked, spelled as the caller spells it" — states no transaction-API
exception, yet the query layer's own missing-capability refusal for the
transaction API carries `operation:"transaction"` (probe P6;
`transaction.ts:331`, `355`), while every other surface's token carries
the `db.` prefix the caller spells (`db.execute`, `db.select`, …). The
exception is stated only in the *other* capability's requirement (rls
delta lines 102-110, scoped to that requirement's own two codes) and in
the skill (`query-layer.md:1052`, which states it for
`driver-missing-capability` explicitly). The delta's own scenario
quietly omits the transaction from its WHEN. **Prescription:** restate
(or cross-reference) the transaction-token exception inside the
missing-capability requirement so it is not falsifiable by its own
shipped observation.

**F3 — MINOR.**
Same delta files, both naming paragraphs
(rls `:93-110`, driver-contract `:11-19`): "every declared-function
call … spelled as the caller spells it" ships as the single token
`db.fn` for every declared function (`db.ts:548`, `context.ts:347`;
P4/P5/P6), while the structurally parallel "every thenable chain
member" got per-member tokens. A caller of `db.fn.a(…)` and
`db.fn.b(…)` cannot tell the two apart from `operation`, which sits
uneasily beside "one name SHALL NOT stand in for several surfaces" if
each declared function is read as its own surface. The scenario,
changeset, and skill all treat the fn API as one surface, so behavior
is internally consistent — the requirement prose just leaves the finer
reading open. **Prescription:** either state that the declared-function
API names the one token `db.fn`, or adopt `db.fn.<name>` tokens; a
one-sentence clarification suffices.

**F4 — MINOR.**
`…/specs/rls-execution-context/spec.md:93-97`: "Every refusal this
requirement raises SHALL name the surface … on the explicitly scoped
path and the provider path alike. That covers both refusals this
requirement raises…". The `context-required` refusal structurally fires
on *neither* named path (a scoped handle has a context by
construction — the shipped code comment at
`packages/query/src/db/context.ts:98` says exactly this; a provider
path always resolves a context or fails with other codes); it fires
only on the plain, no-provider path, which the sentence does not name.
Vacuously true, but the path enumeration misdirects a reader about
where refusal #1 lives. **Prescription:** attach the two-path clause to
the rendering-empty refusal only, or add "and the plain handle".

## Verdict

**PASS — 0 BLOCKING / 1 MAJOR / 3 MINOR.**

- Delta hygiene: both MODIFIED files are strictly additive over the
  main spec (byte-identical preservation of every pre-existing
  paragraph, scenario title, order, and body; diff hunks are
  append-only) — no silent drops or renames.
- Every new scenario is implemented, tested, and probe-confirmed on
  every structurally reachable path×surface×driver cell, with
  `0 cached` gates throughout; the one falsified cell is F1's Nile
  instantiation, whose *outcome* (fail-closed refusal, empty
  transaction) still holds.
- Recommended before archive: apply F1's one-clause WHEN narrowing (and
  optionally F2-F4's clarifications) as a delta-text correction, per
  the correction-then-archive precedent.
