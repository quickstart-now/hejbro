# Decisions — quickstart-now/hejbro#307

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-31T00:00Z_

The delegation is the owner input; the work item is the deferral the
owner parked at the query-layer v1 cut (2026-08-26): left-join
nullability widening needs table-identity tracking on the column
reference and the select builder — deeper than what shipped then, so
every object-projection field typed `| null` and the spec recorded the
widening as known and deliberate. This change removes that widening:
a projected field now follows its declared nullability unless its
source table was actually left-joined, with the tracking done entirely
at the type level (zero runtime change, zero golden movement — a gate
on every task).

