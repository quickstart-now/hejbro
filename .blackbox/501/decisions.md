# Decisions — quickstart-now/hejbro#501

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — FILTER (WHERE …) ships as a filter(aggregate, condition) wrapper over a new AggregateFilterNode variant

_lead · extension · basis 412/D24, D25; D104 (variant over field, measured); D73 (new vocabulary, no version bump); the query-builder requirement's own 'until a real FILTER construct ships' · 2026-09-05T05:49Z · ratified: pending_

Design (design.md Q1-Q4): wrapper like over(); a new ExprNode variant (fn + where), WindowNode.fn widened so `filter … over …` is the only representable order; builder aggregates only, decided by the read-shape vocabulary's keys, filter-not-aggregate otherwise; token aggregate-filter, strict decode, formatVersion unchanged; read shape unwraps like a window. Sequenced after harden-aggregate-vocabulary (#452). query-builder + snapshot-format MODIFIED. Ratification: owner on return.

<a id="r2"></a>
## R2 — filter's accepted set, signature, message shape and scope

_lead · interpretation · 2026-09-05T12:58Z · ratified: pending_

Q1 -- the accepted set. read-shape.ts splits into AGGREGATE_READ_SHAPES and WINDOW_ONLY_READ_SHAPES; BUILDER_READ_SHAPES stays the union of the two, and the union is pinned at the type level to cover BuilderFunctionName exactly (#452 Q1's closure precedent). filter decides what it accepts from AGGREGATE_READ_SHAPES's key set alone: the full builder key set also holds the eleven window-only names and would admit rowNumber(), which this change's delta refuses. Consumers (query/select.ts, db/convert.ts) keep reading BUILDER_READ_SHAPES unchanged. The design document's Q3 sentence is repaired in place to say the aggregate half.

Q2 -- signature. filter = <TExpr extends Expr>(target: TExpr, condition: Condition): Aggregated<TExpr>, built the way overAggregate is (drops sqlName, keeps the symbol-keyed read brand). The parameter stays narrow, so a bare window-only call is refused by tsc; each of the delta's five refusal inputs is written on both axes -- a type refusal (@ts-expect-error) and a runtime diagnostic reached through a cast.

Q3 -- message shape. filter-not-aggregate names both what it accepts and what it got: "filter() accepts one of the builder's aggregates -- count(), min(), max(), sum() or avg() -- and got <what>. Next: wrap one of those aggregates, or, to window a filtered aggregate, filter first and window outside: over(filter(count(), condition), spec)." <what> names the received target in one phrase (a column reference, a raw sql fragment, a declared function call "<schema>.<name>", a window function, an already-windowed expression). No user identifiers in the example.

Q4 -- scope. An aggregate or window call nested inside the filter condition is outside this change's delta and gets no build-time refusal here (D87); Postgres's own 42803 stands and the follow-up is filed under #815. No test pins that input.

Q5 -- files. The D70 completeness fixture in packages/core/test/naming-conventions.test.ts, and the view fixture that produces a filtered aggregate, are inside this change's "the tests beside each".

<a id="r3"></a>
## R3 — the window fn slot widens in two places

_lead · interpretation · 2026-09-05T13:06Z · ratified: pending_

Basis: R1, R2.

The fn slot widening decided in Q2 lands in two files that must move together: ast.ts's WindowNode.fn type and expr/window.ts's own runtime guard. overAggregate refuses anything whose exprNode is not a functionCall, and buildWindowNode's parameter is narrowed the same way, so over(filter(count(), condition), spec) -- required by task 1.1's own red table -- cannot pass on the type widening alone. expr/window.ts is therefore added to task 1.1's Files edited: a missing entry in the file list, not a change of contract. invalid-over-target's message gains a clause saying a filtered aggregate is accepted too. The alternatives (deferring window.ts to a later task, or dropping window composition from this change) are refused: the first leaves task 1.1's own red table failing across a task boundary, the second contradicts the proposal and the query-builder delta.

