# Decisions — quickstart-now/hejbro#754

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Table-bound sites render column references as two-part table.column

_lead · extension · 2026-09-03T17:00Z · ratified: pending_

Ledger R61.

Column references at table-bound sites (check constraints, partial-index predicates, index expression columns, generated expressions, policy using/with-check) render as `"table"."column"`, two-part. Not bare, because in a policy's correlated subquery a bare name can be captured by the inner table (a change of meaning); two-part is accepted by Postgres and Nile alike (measured and documented, #754's table) and matches the owner's explicit-SQL preference. Exception: when the scope holds another row source of the same bare name from a different schema, three-part stays (ambiguity; status quo). Rejected: a Nile preset refusal — it would take CHECK away from Nile users and blame the platform for a renderer defect.

<a id="r2"></a>
## R2 — Scope of the two-part rule; views, the query builder and function bodies are unchanged

_lead · extension · basis R61 · 2026-09-03T17:00Z · ratified: pending_

Ledger R62.

Column references to other tables inside subqueries also render two-part (a Nile tenant-aware table fails on three-part everywhere); table references in `from` / `join` stay three-part. View bodies, the query builder and function bodies are unchanged (the query-builder spec's "projected column stays schema-qualified" contract) — views and queries over Nile tenant-aware tables are unverified and become a follow-up issue. The snapshot format is unchanged (structural nodes); migration goldens under examples/*/migrations are regenerated (the chain tests compare text).

<a id="r3"></a>
## R3 — One team, two groups in sequence; the docs pieces go directly by the lead

_lead · interpretation · basis D110 · 2026-09-03T17:00Z · ratified: pending_

Ledger R65.

#754 is group 1 and #755 group 2, one team (`nl`) in sequence (group 2 uses group 1's export; avoids overlapping edits of expression.ts). Group 2's reviewer runs in constructor mode (catalog text is foreign input, D110). #756 and #757 are out-of-spec documentation PRs done by the lead directly.

<a id="r4"></a>
## R4 — D86's three-part example is an owner gate: queued for the owner

_lead · stop · basis R61 · 2026-09-04T00:00Z · ratified: pending_

Ledger R79.

nl group 1's review passed; three documentation drifts are fixed in the PR. The design decision log's D86 example uses three-part references and is owner-gated, so it is left as is and queued for the owner's return: "enter R61 (two-part rendering at table-bound sites) in the decision log and update D86's example". The reviewer measured that a same-name collision with three-part is accepted by the server while two-part in the same place silently loses the correlation — the spec's exception rule demonstrated.

