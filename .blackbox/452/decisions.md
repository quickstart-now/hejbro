# Decisions — quickstart-now/hejbro#452

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The cast/revive vocabulary becomes one closed table in core, read by both sides; the guard becomes a table-driven ratchet

_lead · extension · basis 412/D24, 412/D25; D102 (cast+revive promise); the read of both sides on 2026-09-05: core's cast side names count/min/max only and never unwraps a window node, query's revive side names four int8 and seven argument-typed functions and reads windows through their inner call -- a nested over(count()) is revived but never cast · 2026-09-05T04:49Z · ratified: pending_

Design (openspec/changes/harden-aggregate-vocabulary/design.md Q1-Q4): a `BUILDER_READ_SHAPES` table in core keyed by the constructors' own name union (type closure via satisfies) with shapes int8 / argument / own; exported like SELECT_CLAUSE_TRAVERSALS (query's contract, not user surface); both sides read it; a window node reads as its inner call on both sides; the drift guard iterates the table (cast iff revive) and a closure test enumerates the public constructors; a live witness for over(count()) past 2^53. Internal invariant made observable in query-execution's nested-revive requirement (MODIFIED) with two new scenarios. Not in scope: db.fn, casting sum/avg. Ratification: owner on return.

