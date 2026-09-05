# Decisions — quickstart-now/hejbro#452

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The cast/revive vocabulary becomes one closed table in core, read by both sides; the guard becomes a table-driven ratchet

_lead · extension · basis 412/D24, 412/D25; D102 (cast+revive promise); the read of both sides on 2026-09-05: core's cast side names count/min/max only and never unwraps a window node, query's revive side names four int8 and seven argument-typed functions and reads windows through their inner call -- a nested over(count()) is revived but never cast · 2026-09-05T04:49Z · ratified: pending_

Design (openspec/changes/harden-aggregate-vocabulary/design.md Q1-Q4): a `BUILDER_READ_SHAPES` table in core keyed by the constructors' own name union (type closure via satisfies) with shapes int8 / argument / own; exported like SELECT_CLAUSE_TRAVERSALS (query's contract, not user surface); both sides read it; a window node reads as its inner call on both sides; the drift guard iterates the table (cast iff revive) and a closure test enumerates the public constructors; a live witness for over(count()) past 2^53. Internal invariant made observable in query-execution's nested-revive requirement (MODIFIED) with two new scenarios. Not in scope: db.fn, casting sum/avg. Ratification: owner on return.

<a id="r2"></a>
## R2 — Review close-out: B1 closes by aligning the delta prose with Q1 (b); N1 gains a witness task for the context-applied half of the preview scenario

_lead · interpretation · basis 452/R1 design Q1 ('whose name is added to the union'); av-reviewer's tsc exit 0 measurement with a 17th constructor; av-planner's grading · 2026-09-05T06:22Z · ratified: pending_

B1 -> (b): the delta's "a constructor without a row fails to type-check" becomes "a name outside the vocabulary's key union fails to type-check at the table's own declaration, and a constructor added without a row is caught by a test that enumerates the constructors from their defining modules" -- the implementation already matches the approved ruling; only the sentence over-claimed. (a) would extend Q1 and is not taken. N1 -> add task 1.6 (~5m): execute.test.ts asserts, on a handle with a context applied, that the statement's own sql/params equal compile() and the context statements precede it in the same transaction. N2/N3/N4 and the two promotions are the planner's. Ratification: owner on return.

<a id="r3"></a>
## R3 — N5: the closure scenario's WHEN names the defining modules, checked to reach the public surface

_lead · interpretation · basis 452/R2 (b); av-reviewer's measurement (a constructor defined in a third module and exported from the barrel passes 20/20 uninvoked) · 2026-09-05T07:02Z · ratified: pending_

Ratified: the scenario WHEN reads "every aggregate and window constructor the builder's own defining modules export -- each one checked to reach the public surface -- is invoked …". The reverse (enumerate the barrel) is not mechanically derivable without the hand list 1.1 removed. Same nature as R2: no code moves, the sentence matches what is measured. Ratification: owner on return.

