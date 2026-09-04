# Decisions — quickstart-now/hejbro#701

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch so = #701 #740 #749 as one change harden-snapshot-and-vendor-order, parallel to ck and qy

_lead · interpretation · basis D1 · 2026-09-04T16:00Z · ratified: pending_

Sixth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the ip team dissolved: #701 (an array reordered inside a kind's snapshot can produce a semantically empty alter — which arrays are sets, and is their serialization canonical), #740 (a vendored contract's client metadata follows JavaScript key order, so integer-like column names sort ahead of the snapshot's physical order) and #749 (a projected `.returning()` under `returns setof <table>` passes declaration and CREATE FUNCTION and fails only when called, unless the projection covers the table's column list exactly) — three bugs about order and shape being honest, one change `harden-snapshot-and-vendor-order`, one PR, tracking issues = the bug issues. Files: `packages/core/src/kinds/*` and `snapshot/*` (#701), `packages/core/src/dsl/define-function.ts` and the body renderer (#749), the vendoring path in `packages/cli/src/vendor*`/`schema-vendoring` (#740) and their tests, `skills/hejbro/` — no overlap with ck (`packages/cli/src/check/*`) or qy (`packages/query`). Team so = planner (fable), implementer (sonnet), reviewer (opus) spec-bound with D110 input tables (#740 is the one foreign-input-shaped surface — a hand-edited vendored contract — so the reviewer constructs contracts for it). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: deterministic output that means what the declaration means).

