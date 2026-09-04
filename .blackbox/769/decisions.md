# Decisions — quickstart-now/hejbro#769

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch qy = #769 #761 #449 as one change harden-query-guards, parallel to ip and ck

_lead · interpretation · basis D1 · 2026-09-04T15:04Z · ratified: pending_

Fifth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the li team dissolved: the `packages/query` bugs #769 (`createDb(conn).as(ctx)`'s table surface skips the unknown-member guard), #761 (the driver-conformance kit's leading-token normalizer keeps a glued semicolon where the spec says the leading word) and #449 (a concurrent `tx.execute` beside a nested transaction is unguarded) — three bugs, one change `harden-query-guards`, one PR, tracking issues = the bug issues. Files: `packages/query/src/client/*`, `packages/query/src/testing/driver-conformance.ts`, the transaction path in `packages/query/src/*` and their tests, the query-layer section of `skills/hejbro/` — no overlap with ip (`packages/cli/src/commands/init.ts`, `config.ts`, `snapshot-file.ts`, `path-probe.ts`) or ck (`packages/cli/src/check/*`). Team qy = planner (fable), implementer (sonnet), reviewer (opus) spec-bound with D110 input tables (the inputs are hejbro's own client calls; #761 also runs the kit against the real `@hejbro/pg` driver on a container). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: a query surface must refuse what it cannot serve, at build time where possible).

