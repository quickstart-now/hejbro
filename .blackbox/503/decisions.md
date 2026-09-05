# Decisions — quickstart-now/hejbro#503

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Cross-family set-operation branches are refused at build time by a measured pair table; unknown is a wildcard; #489 stays separate

_lead · extension · basis 412/D24, D25; the 42804 measurement in #503; hejbro never stricter than Postgres (plpgsql-function-bodies precedent); #489's within-family scope · 2026-09-05T11:00Z · ratified: pending_

Design (design.md Q1-Q4): "unknown" matches every family; the refused pairs are measured on postgres:17 and vendored as the type test's input table (a family without a row fails the enumeration); the rule lives in SetOpResult so core, chain and recursive terms share it; within-family divergence is stated as not covered. query-type-inference ADDED only (no MODIFIED, so it lands in either order with widen-set-op-execute). Ratification: owner on return.

