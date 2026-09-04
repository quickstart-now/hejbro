# Decisions — quickstart-now/hejbro#748

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch co = #748 #751 #774 as one change harden-core-derivations, parallel to li and ip

_lead · interpretation · basis D1 · 2026-09-04T12:53Z · ratified: pending_

Third concurrent batch under #412 D11 and #412/R1–R3: the core bugs #748 ("found" missing from the PL/pgSQL reserved-name list, shadowing FOUND silently), #751 (two function argument keys that derive to one SQL name are not refused) and #774 (diff-engine byIdentity reassembly drops a second same-identity, same-direction change from one kind) — three bugs, one change `harden-core-derivations`, one PR, tracking issues = the bug issues. Files: `packages/core/src/plpgsql/*`, `packages/core/src/dsl/*` (function/argument derivation), `packages/core/src/engine/diff-engine.ts` and their tests — no overlap with the li or ip batches (both `packages/cli`). Core purity holds (no I/O, no runtime deps). Team co = planner (fable), implementer (sonnet), reviewer (opus); the reviewer runs in spec-bound mode with D110 input tables (the inputs are hejbro's own declarations, not foreign input). The lead approves the proposal and settles `[design]` decisions under the owner's delegation (#750 D3/D7).

