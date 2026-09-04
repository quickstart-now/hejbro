# Decisions — quickstart-now/hejbro#551

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — ExecuteResult carries the SetOpNode type through

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R13.

#551: `ExecuteResult` threads the `SetOpNode` type through (a plain fix). Should the type cost explode, a spec-narrowing option goes to the owner's queue.

<a id="r2"></a>
## R2 — Honesty on set-operation typing: the pass-through reaches the left row type only

_lead · extension · 2026-09-03T07:55Z · ratified: pending_

Ledger R23.

Core combinators do not carry the right branch's type, so the pass-through goes as far as the left row type. The corpus requirement states the current contract as MODIFIED (chain = union, core-built execute = left row). A follow-up issue for carrying the right branch's type is filed under #412 by the lead. Changeset: patch (the kit is internal surface outside exports).

