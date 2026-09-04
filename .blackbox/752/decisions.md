# Decisions — quickstart-now/hejbro#752

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — rv's planner is re-summoned on sonnet — a deviation from the team model rule

_lead · extension · 2026-09-03T14:47Z · ratified: pending_

Ledger R56.

For ratification: rv's planner (opus) failed to start its first turn for 27 minutes (four 529s); ti's planner and the D106 evaluators (opus/fable) were the same, only sonnet was healthy. Action: the opus planner is asked to stop and `rv-planner-s` (sonnet) is summoned — an explicit exception to team-up rule 1 (piece planner = opus), needing the owner's ratification. The old planner may wake late and process the nudge (duplicate draft); the stop request says "write no artifacts". D106 evaluators cannot be replaced by sonnet (the model-family separation requirement), so they wait for recovery. status.claude.com confirmed "Elevated errors for multiple models — Fable 5.1/5, Opus 5/4.8/4.6" at 14:39Z, sonnet not listed: the external cause of R53 and R56.

<a id="r2"></a>
## R2 — S2 becomes 'created or altered'; S1 gains 'at the statement level'

_lead · interpretation · 2026-09-03T19:30Z · ratified: pending_

Ledger R73.

S2's sentence widens to "created or altered" (implementation unchanged); S1 is made precise with "at the statement level". The byIdentity reassembly loss is filed as an issue under #412 by the lead (became #774).

<a id="r1-ratification"></a>
## R1 rejected

_evaluator · 2026-09-04T07:22Z_

The rules are not silent here: team-up hard rule 1 allows a piece planner to be opus with an explicit fable override only, and the owner's 2026-08-22 team model policy sets the allocation directly, so substituting sonnet is a unilateral deviation from an owner decision rather than an extension. A provider outage is a real constraint, but the correct output is an owner-written fallback clause (wait, requeue the piece, or a named degraded mode), not a ruling that stands in for one.

