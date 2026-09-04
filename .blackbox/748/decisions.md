# Decisions — quickstart-now/hejbro#748

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch co = #748 #751 #774 as one change harden-core-derivations, parallel to li and ip

_lead · interpretation · basis D1 · 2026-09-04T12:53Z · ratified: pending_

Third concurrent batch under #412 D11 and #412/R1–R3: the core bugs #748 ("found" missing from the PL/pgSQL reserved-name list, shadowing FOUND silently), #751 (two function argument keys that derive to one SQL name are not refused) and #774 (diff-engine byIdentity reassembly drops a second same-identity, same-direction change from one kind) — three bugs, one change `harden-core-derivations`, one PR, tracking issues = the bug issues. Files: `packages/core/src/plpgsql/*`, `packages/core/src/dsl/*` (function/argument derivation), `packages/core/src/engine/diff-engine.ts` and their tests — no overlap with the li or ip batches (both `packages/cli`). Core purity holds (no I/O, no runtime deps). Team co = planner (fable), implementer (sonnet), reviewer (opus); the reviewer runs in spec-bound mode with D110 input tables (the inputs are hejbro's own declarations, not foreign input). The lead approves the proposal and settles `[design]` decisions under the owner's delegation (#750 D3/D7).

<a id="r2"></a>
## R2 — harden-core-derivations approved; Q1 list = plpgsql variables + fully reserved keywords; Q3 lower-cased compare; Q4 wording

_lead · interpretation · basis D1, R1 · 2026-09-04T13:05Z · ratified: pending_

Proposal and delta of `harden-core-derivations` approved under the owner's delegation (#750 D3/D7), pending the planner's one-line `validate --strict` confirmation.

Q1 — the reserved-name list: option (b). The fifteen variables plpgsql declares itself (`found`; `sqlstate`, `sqlerrm`; the `tg_*` trigger variables) plus the fully reserved keywords missing today (`analyse`, `analyze`, `current_catalog`, `except`, `lateral`, `system_user`), whose category in Postgres's own keyword list is the evidence. The type_func_name class (option c) is not added without a measurement: adding it blind risks refusing what Postgres accepts, and the current list's own history (D36) is "reject what was measured to break".
Q3 — case: option (a). `assertValidLocalName` compares lower-cased: Postgres folds an unquoted name, so `FOUND` and `found` are one name; the acceptance says "spelling regardless". Applying `assertSqlName` to loop and row names (option b) is a separate contract and goes to the follow-up queue.
Q4 — message: option (b). "collides with a name plpgsql reserves — a keyword, or a variable plpgsql declares itself such as found or tg_op — which cannot be declared unquoted in a function body. Next: rename it." The code `reserved-local-name` is unchanged (diagnostics spec); the wording now states what was observed instead of calling `found` a reserved word.

<a id="r3"></a>
## R3 — Q2: tg_* refused uniformly in every function

_lead · extension · basis D1, R1 · 2026-09-04T13:05Z · ratified: pending_

Q2 — the `tg_*` variables are refused in every function, trigger or not (option a). One list, one check, one message; the cost is that a plain function cannot name an argument `tg_op`, which no reader would want anyway. Threading a trigger context through `assertValidLocalName` (option b) adds a branch to buy a name nobody should use. This is stricter than Postgres for a non-trigger function, hence an extension, not an interpretation.

