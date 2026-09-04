# Decisions — quickstart-now/hejbro#769

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch qy = #769 #761 #449 as one change harden-query-guards, parallel to ip and ck

_lead · interpretation · basis D1 · 2026-09-04T15:04Z · ratified: pending_

Fifth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the li team dissolved: the `packages/query` bugs #769 (`createDb(conn).as(ctx)`'s table surface skips the unknown-member guard), #761 (the driver-conformance kit's leading-token normalizer keeps a glued semicolon where the spec says the leading word) and #449 (a concurrent `tx.execute` beside a nested transaction is unguarded) — three bugs, one change `harden-query-guards`, one PR, tracking issues = the bug issues. Files: `packages/query/src/client/*`, `packages/query/src/testing/driver-conformance.ts`, the transaction path in `packages/query/src/*` and their tests, the query-layer section of `skills/hejbro/` — no overlap with ip (`packages/cli/src/commands/init.ts`, `config.ts`, `snapshot-file.ts`, `path-probe.ts`) or ck (`packages/cli/src/check/*`). Team qy = planner (fable), implementer (sonnet), reviewer (opus) spec-bound with D110 input tables (the inputs are hejbro's own client calls; #761 also runs the kit against the real `@hejbro/pg` driver on a container). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: a query surface must refuse what it cannot serve, at build time where possible).

<a id="r2"></a>
## R2 — harden-query-guards approved; D-1 ADDED requirement for the whole lookup surface; Q1 scoped handle guarded by the same builder

_lead · interpretation · basis D1, R1 · 2026-09-04T15:17Z · ratified: pending_

Proposal and delta of `harden-query-guards` approved under the delegation (#412 D12/D13 on dev): `validate --strict` valid; schema-vendoring ADDED 1 (D-1 accepted — no requirement described the name-keyed client's unknown-member guard, so the whole surface, client and scoped handle and `fn`, is stated once as "A lookup of a name the contract does not vendor is refused", the unscoped rows as controls), driver-contract MODIFIED 1, query-execution ADDED 1; D-2 (the #449 guard covers the whole transaction tree and settled nested handles) accepted as Q3b.
Q1 (#769): (a) the scoped handle's table surface is guarded by the same builder as the client — same code `unknown-contract-table`, same vendored-list message; (b) `scoped.as` is refused like any unknown name (an `undefined` there is the silent shape this change removes); (c) the pass-through list stays (`then`/`toString`/`valueOf`/`constructor`/`toJSON` and symbol keys).

<a id="r3"></a>
## R3 — Review disposition: passed; 1.2b and 1.4c taken; #845 filed; O1 filed

_lead · interpretation · basis D1, R1, R2 · 2026-09-04T16:50Z · ratified: pending_

Spec-bound review with live PG 17, two rounds (6dde3b13 → c8910936): passed with no blocker in round 1; the two non-blocking items inside this change's purpose were taken (1.2b: `rollback [work|transaction] to savepoint` is a savepoint operation, matching the requirement's own sentence; 1.4c: a settled root `tx` handle is refused with `statement-after-transaction` at every root site and surface — the last door of the #449 invariant), a vendored table named `fn`/`as` masked by the client's members filed as #845; round 2 confirmed both repairs on the wire and found only a tasks.md numbering warning, repaired. Observation O1 (a nested transaction the callback never awaited outlives the root commit and commits its rows alone) is the remaining shape of the same class and is filed for the next query batch. Basis: D13 on dev — what the user wrote must not run silently somewhere else.

