# Decisions — quickstart-now/hejbro#500

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The recursive CTE's outward row type keeps the anchor's types and widens each key's nullability by the recursive term's

_lead · extension · basis 412/D24, 412/D25; the requirement's own measurement (null from the recursive term reaches the rows, pg_typeof stays the anchor's); STRICT (a type that lies is the one thing the type layer must not do); the set-operation result's existing per-key nullability OR · 2026-09-05T05:39Z · ratified: pending_

Design (design.md Q1-Q3): the anchor rule governs types (Postgres's 42804), not nullability (a dimension Postgres never resolves); widen the null dimension only, outward reference only (the recursive callback's reference stays anchor-typed); both builder and chain surfaces. query-type-inference: two MODIFIED requirements; the residue paragraph is replaced by the rule. Ratification: owner on return.

