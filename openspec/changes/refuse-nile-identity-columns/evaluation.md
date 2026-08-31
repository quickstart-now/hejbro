# D106 adversarial spec-only evaluation — `refuse-nile-identity-columns`

| Field | Value |
| --- | --- |
| Change id | `refuse-nile-identity-columns` (#573) |
| Evaluated sha | `59a77470` (dev squash) |
| Evaluator model | `fable` (context-free session; not a piece-team member) |
| Start stamp | `2026-08-31T22:33:01` (machine local — export creation time) |
| End stamp | `2026-08-31T13:44:44Z` (`date -u`, rendered by the machine locale in the original run) |
| Input | export directory only: `…/scratchpad/d106-nile-identity` (no `.git`; `proposal.md`, `tasks.md`, `design.md`, `blackbox/`, `docs/`, `openspec/changes/archive/`, `task-times.csv` deliberately absent) |

**Verdict: PASS — BLOCKING 0 / MAJOR 1 / MINOR 6.**
No delta scenario contradicts shipped behavior. All ten scenarios of the
MODIFIED requirement were probed against the built `@hejbro/nile` and
observed to hold, including the three new ones. Findings are binding and
consistency gaps, not contract contradictions.

Counting policy: only gaps attributable to this change's new or modified
content are counted. Gaps in the seven scenarios this change retained
byte-for-byte are listed under "Inherited (not counted)" so the count
stays comparable to the prior D106 (add-nile-preset, 0/3/8) without
re-billing the same items.

---

## Integrity disclosure

- **Reads outside the export: none by intent.** Two incidental exposures,
  neither used:
  1. One `grep` whose output exceeded the display limit caused the harness
     to persist the raw output to
     `~/.claude/projects/…/tool-results/b5c5khmhv.txt`. I did **not** open
     that file; I re-ran the query with narrower output instead.
  2. This session's system context carried the repository's `AGENTS.md`
     / `CLAUDE.md` / `CLAUDE.local.md` and the owner's memory notes. The
     memory notes contain phase bookkeeping (issue numbers such as #573,
     #574, a "nl-Q1…Q4" owner-return queue, and the prior D106 score
     0/3/8 that the lead also supplied). None of it describes this
     change's design reasoning, proposal, or probes. Influence on the
     verdict: none beyond the calibration reference the lead gave.
- **Own logs outside the export:** command output was tee'd to
  `/tmp/d106-*.log` and `/tmp/d106-post-list.txt` and read back. Their
  content originates only from commands run inside the export.
- **Network:** `gh` never invoked; no GitHub or web lookups; `openspec`
  CLI never invoked. `pnpm install --frozen-lockfile --prefer-offline`
  reported `resolved 217, reused 217, downloaded 0`; I cannot rule out a
  registry metadata request by pnpm itself. `husky` `prepare` ran and
  reported `.git can't be found` (no hooks installed).
- **Writes inside the export:** exactly one temporary file,
  `packages/nile/test/d106-probes.test.ts` (288 lines, 19 probes),
  deleted before the clean gates ran. Proof of no other change (no git,
  so a hash comparison):
  - Baseline, before install (782 files):
    `find . -type f | sort | shasum -a 256` →
    `e367e2daedca9459d34a8c5825489a477f73dff7ea23d61b01b417446cf505f2`
    ; `find . -type f -exec shasum -a 256 {} + | sort | shasum -a 256` →
    `13bd6b359dedb1fcb46aa354503291369378ab4d4a78c6ad9f15f01bdf4b2ad7`
  - After deletion and all gates, excluding only build artifacts
    (`node_modules`, `dist`, `.turbo`, `.husky/_`, `*.tsbuildinfo`,
    `coverage`): 782 files, list hash `e367e2da…f505f2` (identical),
    content hash `13bd6b35…4b2ad7` (identical).
  - Build artifacts added (not source): `./.turbo`, `packages/*/dist`
    (core, query, pg, nile), `packages/*/.turbo`, `node_modules` trees.
- **Bash discipline:** every Bash call was sequential; no parallel Bash.

---

## Method

All commands run from the export root unless noted.

| Step | Command | Result (verbatim) |
| --- | --- | --- |
| Spec byte-compare (retained 7) | `diff <(sed -n '92,137p' openspec/specs/preset-validation/spec.md) <(sed -n '37,82p' openspec/changes/refuse-nile-identity-columns/specs/preset-validation/spec.md)` | `45a46` / `>` (one blank line — the separator before the delta's 8th scenario; scenario text byte-identical) |
| Spec SHALL diff | `diff <(sed -n '69,90p' …specs/…) <(sed -n '6,35p' …changes/…)` | hunks `4,5c4,7` (identity added to the refusal list) and `17c19,25` (identity-measured sentence + no-PK SHALL NOT sentence) — quoted in §1 |
| Scenario count | `grep -c '#### Scenario'` | main spec `13` (whole file), delta `10` |
| Install | `pnpm install --frozen-lockfile --prefer-offline` | `Done in 2.7s`, `resolved 217, reused 217, downloaded 0` |
| Build | `TURBO_FORCE=1 pnpm --filter @hejbro/nile... build` | pnpm runs each package's `tsdown` directly (not turbo) — no turbo summary exists for this step, hence no cache by construction; `core`, `query`, `pg`, `nile` all `Build complete` |
| Probes (isolated) | `packages/nile$ pnpm exec vitest run test/d106-probes.test.ts --disableConsoleIntercept --reporter=verbose` | `Test Files 1 passed (1)`, `Tests 19 passed (19)` |
| Gate: test (with probes) | `TURBO_FORCE=1 pnpm exec turbo run test --filter=@hejbro/nile --filter=@hejbro/skills` | nile `Test Files 6 passed (6)`, `Tests 75 passed (75)`; skills `1 failed | 4 passed (5)`, `Tests 1 failed | 20 passed (21)`; `Tasks: 1 successful, 2 total` / `Cached: 0 cached, 2 total` |
| Gate: check-types + test (clean, probe deleted) | `TURBO_FORCE=1 pnpm exec turbo run check-types test --filter=@hejbro/nile --filter=@hejbro/skills` | nile `Test Files 5 passed (5)`, `Tests 56 passed (56)`; skills same single failure; `Tasks: 2 successful, 4 total` / `Cached: 0 cached, 4 total` (turbo aborted the remaining tasks on the skills failure — no `--continue`) |
| Gate: check-types (clean, forced, `--continue`) | `TURBO_FORCE=1 pnpm exec turbo run check-types --filter=@hejbro/nile --filter=@hejbro/skills --continue` | `@hejbro/nile:check-types: > tsc --noEmit` clean; `Tasks: 4 successful, 4 total` / `Cached: 0 cached, 4 total` / `Time: 8.359s` |
| Gate: biome | `pnpm check` | `Checked 560 files in 330ms. No fixes applied.` exit 0 |
| Gate: bans | `pnpm check:bans` | `check-bans: ok — … in 182 package source files` |
| Gate: next marker | `pnpm check:next-marker` | `check-next-marker: ok — every user-facing diagnostic site … states a "Next:"` |
| Gate: diagnostic xref | `pnpm check:diagnostic-xref` | `4 cross-reference(s) checked against 185 defined code(s)` / `ok -- every cited code is defined` |

**The one red test is an export artifact, not a change defect.**
`packages/skills/test/links.test.ts` › "every backticked/linked repo path
in skills/hejbro resolves on disk" reports four missing paths:
`docs/guide/getting-started.md`, `docs/specs/2026-08-19-hejbro-design.md`,
`docs/guide/indexes.md`,
`openspec/changes/archive/2026-08-31-extend-query-runtime/measurement.md`
— all under directories the export deliberately strips.
`skills/hejbro/references/nile-preset.md` cites none of them (its only
`docs/` hit is the `https://thenile.dev/docs/…` URL). `nile-preset-doc.test.ts`
passed `6 tests`.

---

## 1. Delta spec vs main spec

**Retained scenarios (7):** byte-identical in title, order and body
(command and output above). The main spec's other two requirements
("A preset refuses declarations its platform will not accept", "A refusal
states the evidence behind it") are not touched by the delta.

**Requirement text changes (MODIFIED):**

1. Refusal list gains *"an identity column (`generated always as identity`
   or `generated by default as identity`) in a tenant-aware table"*.
2. Evidence paragraph gains: *"The identity refusal is measured too: both
   identity kinds on a tenant-aware table are rejected by the platform's
   own container with `IDENTITY columns are not supported for
   tenant-aware table`, and the published limitations table does not list
   them. A tenant-aware table that declares no primary key at all was
   measured on the same container and accepted, so the preset SHALL NOT
   refuse it."*

**New scenarios (3) and what each asserts:**

- **S8 "An identity column in a tenant-aware table is refused"** — WHEN a
  table carrying `tenant_id uuid` declares a column as either identity
  kind, THEN generation fails naming that column, the error states the
  refusal rests on a measurement, code `nile-identity-in-tenant-table`.
- **S9 "An identity column outside a tenant-aware table is untouched"** —
  WHEN a table with no `tenant_id uuid` declares an identity column, THEN
  generation succeeds (no widening).
- **S10 "A tenant-aware table without a primary key is accepted, as
  measured"** — WHEN a `tenant_id uuid` table declares no primary key and
  nothing refused, THEN generation succeeds and emits the same `CREATE
  TABLE` as with no preset.

Delta text conforms to the export's `openspec/config.yaml` spec rule
(measured facts inline, no issue numbers, no dates, no change ids).

---

## 2. Probe table

Probe file: `packages/nile/test/d106-probes.test.ts` (temporary, deleted).
Fixtures use `schema("app")`, `nilePreset.validators`, `emptySnapshot`
unless stated. Observed output is the `[PROBE …]` line verbatim.

| Probe | Scenario | Fixture | Observed (verbatim) | Verdict |
| --- | --- | --- | --- | --- |
| P1 | S8 (always) | `id uuid pk, tenantId uuid pk, seq: integer().generatedAlwaysAsIdentity()` | `P1.codes ["nile-identity-in-tenant-table"]`; `P1.sql ""`; `P1.hasChanges false`; message: `Nile's platform refuses an identity column ("seq") in the tenant-aware table "app"."widgets" -- this refusal rests on a measurement, not on the platform's published limitations (measured 2026-08-31 on the platform's own test container: "IDENTITY columns are not supported for tenant-aware table", for both the ALWAYS and the BY DEFAULT kind). Next: use a uuid key (a uuid column with a default) instead of an identity column, or drop the tenant_id column if this table is not tenant-scoped.` | holds |
| P2 | S8 (byDefault) | same with `generatedByDefaultAsIdentity()` | `P2.codes ["nile-identity-in-tenant-table"]`; message identical to P1 | holds |
| P3 | S8 quantifier: integer *family* widths | `big: bigint().generatedAlwaysAsIdentity(), small: smallint().generatedByDefaultAsIdentity()` | `P3.codes [code, code]`; `P3.columnsNamed ["big","small"]` | holds (validator keys on `columnState.identity`, width-agnostic) |
| P4 | S8 + S6 interplay | identity column is itself the PK, composite with `tenant_id` | `P4.codes ["nile-identity-in-tenant-table"]` (exactly one) | holds; no spurious PK refusal |
| P5 | S8 with sequence options | `bigint().generatedByDefaultAsIdentity({ startWith: 1000, cycle: true })` | `P5.codes ["nile-identity-in-tenant-table"]` | holds |
| P6 | S9 boundary: `tenant_id` typed `text` | `tenantId: text().notNull()` + identity | `P6.codes []`; `P6.sqlEqual true` | holds — "tenant-aware" is `tenant_id uuid` only, no widening |
| P7 | S8: explicit snake key | `tenant_id: uuid().primaryKey()` | `P7.codes ["nile-identity-in-tenant-table"]` | holds |
| P8 | S8 "naming that column", multiple | two identity columns `a`, `b` | `P8.codes [code, code]`; `P8.names ["a","b"]` | holds (one diagnostic per column, each named) |
| P9 | S8 via registered-preset path | `presetValidators([nilePreset])` | `P9.codes ["nile-identity-in-tenant-table"]` | holds |
| P10 | S8 "at generate time" on the ALTER path | previous snapshot = tenant-aware table without identity; new declaration adds identity column | `P10.codes ["nile-identity-in-tenant-table"]`; `P10.sql ""` | holds — refusal is not create-only |
| P11 | S9 (always, byDefault, bigint, options) | non-tenant table `id: integer().generatedAlwaysAsIdentity().primaryKey(), seq: bigint().generatedByDefaultAsIdentity({ startWith: 10 })` | `P11.codes []`; `P11.sqlEqual true`; `P11.sqlHasIdentity true` (`generated always as identity` and `generated by default as identity (start with 10)` both rendered) | holds |
| P12 | S10, the exact measured shape | `tenantId: uuid().notNull(), name: text()` (no PK) | `P12.codes []`; `P12.sql ["create table \"app\".\"widgets\" (","\t\"tenant_id\" uuid not null,","\t\"name\" text"]`; SQL equal to no-preset, `hasChanges true` | holds |
| P13 | S10 + S8 | no-PK tenant-aware table with an identity column | `P13.codes ["nile-identity-in-tenant-table"]` (no PK refusal) | holds |
| P14 | "Another preset's output is unchanged" (general req.) | `presetValidators([supabasePreset])` on the P1 table | `P14.codes []`; `P14.warnings []`; `P14.sqlEqual true` | holds (Neon exports no `Preset`, so Supabase is the only other one) |
| P15 | S4 + S8 coexistence | `id: bigserial().primaryKey()`, `tenantId uuid pk`, `seq` identity | `P15.codes ["nile-serial-in-tenant-table","nile-identity-in-tenant-table"]` | holds — separate codes, no folding |
| P16 | S7 (retained) | composite PK, `name text` | `P16.sqlEqual true`, no errors | holds |
| P17 | S8 boundary: nullable `tenant_id uuid` | `tenantId: uuid()` (no notNull) + identity, two tables | `P17.codes [code, code]` | holds — nullability irrelevant to tenant-awareness |
| P18 | informational | `tenantId: uuid().array()` + identity | `P18.codes []`; `P18.createTable ["\t\"tenant_id\" uuid[],"]` | consistent with the spec's literal `tenant_id uuid`; platform behavior for `uuid[]` is outside the spec — not a finding |
| P19 | informational | diagnostic shape | `{"code":"nile-identity-in-tenant-table","keys":["code","declaredAt","name"]}` | `declaredAt` is the table's (same as the serial/PK validators) — unspecified, consistent |

Existing suite (`validators.test.ts`, `preset.test.ts`, `exports.test.ts`,
`context.test.ts`, `driver.test.ts`) passed 56/56 under the forced gate.

---

## 3. SHALL → Scenario → Test (both directions)

| # | SHALL clause (delta requirement) | Scenario | Test binding |
| --- | --- | --- | --- |
| R1 | refuse RLS enablement and policies | S1 | `validators.test.ts:37` (policy fixture; RLS enablement fires through the same fixture) |
| R2 | refuse functions and triggers | S2 | `:71`, `:98` |
| R3 | refuse grants; error says measured | S3 | `:130` |
| R4 | refuse serial family in tenant-aware; measured | S4 | `:150` (`it.each` × 3) |
| **R5** | **refuse both identity kinds in tenant-aware; measured; container text `IDENTITY columns are not supported for tenant-aware table`** | **S8** | **`:404` (`it.each` × 2: code, column name, measured phrase, `Next:`). The container text itself is asserted only in the doc test `packages/skills/test/nile-preset-doc.test.ts:44-46`; the measurement claim has no live-witness case (F1)** |
| R6 | refuse PK excluding `tenant_id`; measured | S6 | `:237` |
| R7 | platform attribution for policies/functions/triggers | S1, S2 | `:64`, `:93`, `:123` |
| R8 | published table does not list identity | (no scenario — documentary) | `nile-preset-doc.test.ts:50-58` pins the verbatim 3-row table; nothing asserts identity's *absence* from it (weak, see F6) |
| **R9** | **no-PK tenant-aware table SHALL NOT be refused; measured accepted** | **S10** | **`:287` (generate-time equality). The "accepted and takes rows under a tenant context" measurement has no live-witness case (F1)** |
| R10 | SHALL NOT refuse what hejbro cannot express | (no scenario) | `nile-preset-doc.test.ts:61` (COMMENT documented) — inherited |
| — | (S5) serial outside untouched | S5 | `:175` (`serial` only) — inherited |
| — | (S7) tenant-aware table ordinary | S7 | `:190` |
| — | **(S9) identity outside untouched** | **S9** | **`:439` — `generatedAlwaysAsIdentity` only; `byDefault` untested (F5; behavior confirmed by P11)** |
| — | general req.: "gives the caller a way forward" | — | `:332` (every code carries `Next:`, includes the identity code) |

**Reverse direction — tests/behaviors with no delta scenario:**

- `validators.test.ts:214`, `:306` (mutation-proof fixtures) and
  `preset.test.ts:13/22` (validator count = 6): process/implementation
  pins, no scenario; harmless.
- Identity error text embeds a **date** (`measured 2026-08-31 …`) — no
  spec sentence asks for or forbids it; the other three measured
  messages carry none (F4).
- `declaredAt` on the diagnostic is the table's, not the column's —
  unspecified; consistent with the serial validator.
- `tenant_id uuid[]` is not tenant-aware for the validator (P18) — the
  spec's literal wording (`tenant_id uuid`) covers this; no finding.

**Scenarios with no test:** none. **SHALLs with no scenario:** R8, R10
(documentary by design; R10 inherited).

---

## 4. Findings

### F1 — MAJOR — the two new measured claims have no executable witness
- **Where:** `openspec/changes/refuse-nile-identity-columns/specs/preset-validation/spec.md:24-30`
  (requirement text) vs `packages/nile/test/integration/nile.integration.test.ts`
  (the Docker-gated live witness, pinned by digest; its header says
  *"if the digest ever changes, re-measure every scenario in this
  file"*).
- **What:** the requirement asserts two platform facts — (a) both
  identity kinds on a tenant-aware table are rejected with `IDENTITY
  columns are not supported for tenant-aware table`; (b) a no-PK
  tenant-aware table is accepted and takes rows under a tenant context.
  Neither shape appears in the integration suite; the only bindings are
  prose (a test title at `validators.test.ts:287`, the skill doc, the
  changeset). A digest bump would re-measure "every scenario in this
  file" and still never re-check either claim. This is a spec sentence
  with no test behind it — the repository's own stated anti-pattern
  (`nile-preset.md:133-139`).
- **Not a contradiction:** generate-time behavior (S8/S10) is fully
  bound and observed. The gap is the evidence claim, which is the
  *only* basis for the refusal.
- **Prescription:** add two cases to `nile.integration.test.ts`:
  `create table … (tenant_id uuid not null, seq integer generated
  always as identity …)` and the `by default` twin, each expected to
  reject with `/IDENTITY columns are not supported for tenant-aware
  table/`; and `create table … (tenant_id uuid not null, name text)`
  expected to succeed and accept one insert under `asTenant(TENANT_A)`.
  (The inherited serial/PK measured claims share the gap — see
  "Inherited".)

### F2 — MINOR — skill doc enumerates "all three" measured refusals; there are four
- **Where:** `skills/hejbro/references/nile-preset.md:127-131` —
  *"`GRANT`, the `serial`/… refusal …, and the tenant-aware primary key
  refusal are **not** in this table — all three refusals rest on a
  measurement"*.
- **What:** identity (`nile-identity-in-tenant-table`) is the fourth
  measured-only refusal (row at line 95 and the paragraph at 105-109 say
  so); this paragraph was not updated. Internally inconsistent, no
  contract effect.
- **Prescription:** add the identity refusal and say "all four".

### F3 — MINOR — validator comment contradicts the delta on the no-PK shape
- **Where:** `packages/nile/src/validators.ts:275-281`
  (`nileTenantPrimaryKeyValidator` doc comment): *"that shape was never
  exercised against the container, so this validator makes no claim
  about it (recorded as unmeasured in the preset's own documentation…)"*.
- **What:** the delta requirement (`spec.md:28-30`), the skill doc
  (`nile-preset.md:99-102`) and the changeset all state the shape *was*
  measured and accepted. The comment is stale; behavior is correct
  (`if (primaryKeyColumns.length === 0) return []`).
- **Prescription:** rewrite the comment to state the measured fact and
  point at S10.

### F4 — MINOR — the identity error text embeds a measurement date
- **Where:** `packages/nile/src/validators.ts:322` — `(measured
  2026-08-31 on the platform's own test container: …)`.
- **What:** the grant, serial and PK messages (`:79`, `:86`, `:93`)
  carry the evidence clause without a date; the identity message alone
  carries one, no test pins it, and a date inside user-facing error text
  goes stale silently (the spec's "floor, not a ceiling" point is
  already made by the measured clause). Spec-neutral; consistency only.
- **Prescription:** drop the date from the message (keep it in the
  skill doc), or apply one shape to all four measured messages.

### F5 — MINOR — S9 is bound to one identity kind only
- **Where:** `packages/nile/test/validators.test.ts:439-450`.
- **What:** S9's WHEN is "declares an identity column"; the test covers
  `generatedAlwaysAsIdentity()` only. P11 confirms `byDefault` and
  `bigint` also pass, so this is a binding gap, not a behavior gap.
- **Prescription:** `it.each` over both kinds, mirroring the S8 test.

### F6 — MINOR — doc test does not bind the identity row's evidence grade
- **Where:** `packages/skills/test/nile-preset-doc.test.ts:41-48`.
- **What:** the case is titled "…the tenant-aware identity refusal are
  marked measured-only" but asserts only that `**measured only**`,
  the code, the container text and "not in the platform's published
  table" each appear *somewhere* in the file. Changing the identity
  row's evidence cell to "platform-documented" would still pass.
- **Prescription:** assert on the row itself, e.g. a regex over the
  flattened doc spanning `nile-identity-in-tenant-table` … `**measured
  only**` on the same table line.

### F7 — MINOR — `Next:` prescription presumes the identity column is a key
- **Where:** `packages/nile/src/validators.ts:322` — *"Next: use a uuid
  key (a uuid column with a default) instead of an identity column, or
  drop the tenant_id column…"*.
- **What:** the refused shape is any identity column (the S8 test's own
  fixture is a non-key `seq`). For a non-key sequence column a uuid is
  not a substitute (no ordering semantics); the message offers no path
  for that case. Satisfies the spec's "a way forward" minimally; narrower
  than the refusal it accompanies.
- **Prescription:** phrase the way forward for both uses, e.g. "for a
  key, use a uuid column with a default; for a counter, assign the value
  in application code or keep the sequence in a non-tenant-aware table".

### Inherited (not counted — retained scenarios, byte-identical to the prior spec)
- Serial/PK measured claims (R4, R6) share F1's live-witness gap.
- S1 has no fixture for RLS enablement *without* a policy
  (`validators.ts:96-102` claims exactly one diagnostic for it).
- S5 is bound to `serial` only (`:175`), not `smallserial`/`bigserial`.
- R10 (COMMENT) is documentary only, by design.

### Checked and clean (no finding)
- Retained 7 scenarios byte-identical; requirement text conforms to the
  delta-spec rules in `openspec/config.yaml`.
- Code `nile-identity-in-tenant-table` is defined once (`validators.ts:346`),
  registered sixth in `preset.ts:42`, exported through the barrel
  (`exports.test.ts` pins exactly `asTenant`, `nileDriver`, `nilePreset`),
  carries `Next:` (gate ok), and is documented in the skill table with
  the DSL spellings `.generatedAlwaysAsIdentity()` /
  `.generatedByDefaultAsIdentity()`.
- Container text in the error message equals the spec's quoted text
  byte-for-byte (P1).
- `.changeset/refuse-nile-identity-columns.md`: `@hejbro/nile: minor`,
  names the code, the measured basis, the no-PK fact, "No other preset's
  output changes" (P14 confirms).
- `README.md` has no Nile refusal list to update; `packages/nile/README.md`
  defers to the skill doc.
- Biome, bans, next-marker, diagnostic-xref, `tsc --noEmit` (nile): all
  green under forced turbo (0 cached).

---

## Verdict

**PASS** — BLOCKING **0**, MAJOR **1** (F1), MINOR **6** (F2–F7).
The archive is not blocked: every delta scenario is satisfied by the
shipped `@hejbro/nile`, both in its own suite and under 19 independent
probes. F1 should be filed as a tracked sub-issue (the live witness does
not corroborate the two new measured claims); F2–F7 are wording and
binding tidy-ups.

Temporary probe file `packages/nile/test/d106-probes.test.ts` was deleted;
post-run hashes equal the pre-run baseline (see Integrity disclosure).
