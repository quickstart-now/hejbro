# Decisions — quickstart-now/hejbro#778

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch ck = #778 #779 #781 as one change harden-check-expressions, parallel to li and ip

_lead · interpretation · basis D1 · 2026-09-04T14:14Z · ratified: pending_

Fourth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the co team dissolved: the `check` expression bugs #778 (index predicates and generated-column expressions are not compared through the server's rendering as the spec claims), #779 (the not-compared finding delimits expression texts with the quote SQL identifiers use) and #781 (a matching generated column is always reported as a default difference) — three bugs, one change `harden-check-expressions`, one PR, tracking issues = the bug issues. Files: `packages/cli/src/check/*` and their tests, the check section of `skills/hejbro/` — no overlap with li (`apply/*`, `commands/migrate|status`) or ip (`commands/init.ts`, `config.ts`). Team ck = planner (fable), implementer (sonnet), reviewer (opus) in constructor mode (the input is the database catalog and the server's own rendering — foreign input, D110). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: a check must tell the truth about whether the database matches the declaration).

