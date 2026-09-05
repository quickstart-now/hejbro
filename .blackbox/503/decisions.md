# Decisions — quickstart-now/hejbro#503

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Cross-family set-operation branches are refused at build time by a measured pair table; unknown is a wildcard; #489 stays separate

_lead · extension · basis 412/D24, D25; the 42804 measurement in #503; hejbro never stricter than Postgres (plpgsql-function-bodies precedent); #489's within-family scope · 2026-09-05T11:00Z · ratified: pending_

Design (design.md Q1-Q4): "unknown" matches every family; the refused pairs are measured on postgres:17 and vendored as the type test's input table (a family without a row fails the enumeration); the rule lives in SetOpResult so core, chain and recursive terms share it; within-family divergence is stated as not covered. query-type-inference ADDED only (no MODIFIED, so it lands in either order with widen-set-op-execute). Ratification: owner on return.

<a id="r2"></a>
## R2 — #966 folds into this change: the recursive anchor/term pair is the third surface

_lead · extension · basis R1 · 2026-09-05T17:38Z · ratified: pending_

The D106 round-1 review of harden-recursive-nullability (archived in #968) filed #966: an anchor `name: nodes.name` (text) against a recursive term `name: nodes.id` (integer) type-checks and the server refuses it with 42804. That is exactly the third surface R1 already names -- the recursive anchor/term pair consumes SetOpResult's compatibility test -- so #966 folds into harden-set-op-families under 412/R2 (several issues, one change, one PR) instead of opening as its own change. Consequences: the PR closes #503 and #966; task 1.2's recursive-term rows include #966's own input (text anchor, integer term, one shared key) as a named row, red first; the ADDED requirement keeps #966's neighbour reading in mind -- the same-family requirement's framing must not read as though a family-level check existed before this change, because this change is that check. The measured pair table (task 1.1) is the only source of which pairs are refused; #966's text/integer pair is one measurement in it, not an assumption.

