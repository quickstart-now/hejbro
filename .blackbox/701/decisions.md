# Decisions — quickstart-now/hejbro#701

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch so = #701 #740 #749 as one change harden-snapshot-and-vendor-order, parallel to ck and qy

_lead · interpretation · basis D1 · 2026-09-04T16:00Z · ratified: pending_

Sixth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the ip team dissolved: #701 (an array reordered inside a kind's snapshot can produce a semantically empty alter — which arrays are sets, and is their serialization canonical), #740 (a vendored contract's client metadata follows JavaScript key order, so integer-like column names sort ahead of the snapshot's physical order) and #749 (a projected `.returning()` under `returns setof <table>` passes declaration and CREATE FUNCTION and fails only when called, unless the projection covers the table's column list exactly) — three bugs about order and shape being honest, one change `harden-snapshot-and-vendor-order`, one PR, tracking issues = the bug issues. Files: `packages/core/src/kinds/*` and `snapshot/*` (#701), `packages/core/src/dsl/define-function.ts` and the body renderer (#749), the vendoring path in `packages/cli/src/vendor*`/`schema-vendoring` (#740) and their tests, `skills/hejbro/` — no overlap with ck (`packages/cli/src/check/*`) or qy (`packages/query`). Team so = planner (fable), implementer (sonnet), reviewer (opus) spec-bound with D110 input tables (#740 is the one foreign-input-shaped surface — a hand-edited vendored contract — so the reviewer constructs contracts for it). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: deterministic output that means what the declaration means).

<a id="r2"></a>
## R2 — harden-snapshot-and-vendor-order approved; D1 set-array table; D2 canonicalize hook, canonical compare, byte-exact hash chain, formatVersion 8 kept; D3 rendering order

_lead · interpretation · basis D1, R1 · 2026-09-04T16:21Z · ratified: pending_

Proposal and delta of `harden-snapshot-and-vendor-order` approved under the delegation (#412 D12/D13 on dev): `validate --strict` valid; ADDED deltas in snapshot-format, snapshot-diff, cli-commands, schema-vendoring, and ADDED+REMOVED+MODIFIED in plpgsql-function-bodies. The owner's own comment on #701 (J17, 2026-09-02) — format decision, verify comparison rule, golden rewrite and per-kind array census in one change — is honoured by the shape below.
D1 — the set arrays: `policy.roles` (sorted by name), `trigger.events` (fixed insert → update → delete) and `events[].columns` (sorted), `table.indexes` and `table.checks` (sorted by name); already canonical from the DSL: `grant.privileges`, `table.foreignKeys`; order-bearing and untouched: columns (physical), index columns, foreign-key column pairs, function args, enum values, view bodies, expression nodes; a preset's own arrays (`bucket.allowedMimeTypes`) are the preset's to canonicalize.
D2 — option (2): an optional `ObjectKind.canonicalize` hook (additive, like `requiredKeys`) and a core `canonicalizeSnapshot`; `buildSnapshot` applies it when writing, and `diffSnapshots`, `snapshotChangedFrom` and verify's check 2 compare canonical forms; `parseSnapshot` and the hash chain (check 1) stay byte-exact, so a hand edit — even a reordering — is still caught by the tip hash; formatVersion stays 8; a project outside this repository sees no movement. Option (1) (bump to 9) forces pin-or-reset on every v8 project for a change that is not a format change; option (3) produces the zero-statement migration and the red verify the owner rejected in J17. In-repo goldens and the two examples are regenerated once (same procedure as the v7 → v8 bump).
D3 — the rendering order after canonicalization (`to <sorted roles>`, `after insert or update`) applies to objects created or recreated from now on; committed migrations are history.

<a id="r3"></a>
## R3 — so (b) accepted at 1c8fb17f: restate pins rewritten per the approved delta; per-key canonicalization; reviewer summoned

_lead · interpretation · basis R1, R2, 412/D13 · 2026-09-04T21:29Z · ratified: pending_

Group 1 (b) accepted at 1c8fb17f: 9/9 tasks, every gate green (test 18/18 with hejbro 92 files / 1066 tests, examples' chains and verify green, cli-smoke real tsc 5/5). Rulings on the facts reported:
1. Tripwire — the four restate pins in `generate-command.test.ts` (D106 R5/J17: a set reorder produced a zero-statement `restate_<table>` migration) contradicted the approved cli-commands delta's first scenario; rewriting three to "no changes, no file, verify 0" and dropping the slug-determinism pin is the approved contract applied, not drift. The core `migration-file.test.ts` restate pin stays: the fallback remains reachable by other statement-less moves and its spec sentence stands.
2. Plan deviation — per-key canonicalization inside `diffSnapshots` so the `malformed-snapshot-node` guard is not bypassed (whole-snapshot canonicalization leaked a raw TypeError). Intent unchanged; recorded in design.md 93077cb7.
3. The 1.3c replay procedure (goldens by `UPDATE_GOLDEN=1`, examples by the built CLI step by step, banner hash lines only moved) is the accepted way to move committed artefacts: no hand edits.
4. The stray `init` files in the main checkout were removed; the absolute-path rule stands.
5. Out-of-piece observations: (a) "`blackbox index` does not regenerate the root README" — not reproduced by the lead (index rewrote `.blackbox/README.md` at 3437086a during the ck rebase; the conflict case needs the markers removed first) — no issue; (b) the restate fallback's CLI reachability shrank by design — no issue.
Reviewer summoned: spec-bound over the five deltas, constructor mode for #740 (hand-written vendored contracts, list form and legacy object form, rendered through `createDb`) and #749 (real `create function` and calls on postgres:17-alpine), detached worktree at 1c8fb17f.

<a id="r4"></a>
## R4 — so (c) accepted at c8f90f5d: review 0/3/17; NB-1/NB-2 filed under #815, corpus to #714; PR by the lead

_lead · interpretation · basis R3, 412/D13 · 2026-09-04T21:54Z · ratified: pending_

(c) accepted at c8f90f5d (d9be6ec9 + one docs commit: the two schema-vendoring WHEN clauses name the hand-edited / foreign-toolchain provenance of a non-identifier key). Constructor review at d9be6ec9: BLOCKING 0 / NON-BLOCKING 3 / OK 17, every gate green in the detached worktree. NB-1 (two update events on one trigger: canonical order not total, but Postgres refuses the SQL) and NB-2 (duplicate set members pass) are pre-existing input-validation gaps outside this delta — filed as follow-ups under #815 (trigger events; policy roles); the corpus candidates went to #714. NB-3 repaired in wording only, no re-review (normative sentences and code unchanged). Lead's next: rebase onto dev after #855 merges, gates, PR (Closes #701 #740 #749), pin, merge, D106.

