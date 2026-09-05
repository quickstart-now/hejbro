# Decisions — quickstart-now/hejbro#501

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — FILTER (WHERE …) ships as a filter(aggregate, condition) wrapper over a new AggregateFilterNode variant

_lead · extension · basis 412/D24, D25; D104 (variant over field, measured); D73 (new vocabulary, no version bump); the query-builder requirement's own 'until a real FILTER construct ships' · 2026-09-05T05:49Z · ratified: pending_

Design (design.md Q1-Q4): wrapper like over(); a new ExprNode variant (fn + where), WindowNode.fn widened so `filter … over …` is the only representable order; builder aggregates only, decided by the read-shape vocabulary's keys, filter-not-aggregate otherwise; token aggregate-filter, strict decode, formatVersion unchanged; read shape unwraps like a window. Sequenced after harden-aggregate-vocabulary (#452). query-builder + snapshot-format MODIFIED. Ratification: owner on return.

