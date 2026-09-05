# Design: add-aggregate-filter

Settled by the lead under the owner's full delegation for this pass;
recorded as a ruling on the change's issue.

## Q1 — Wrapper or method

- (i) `filter(count(), cond)` — a wrapper, like `over`.
- (ii) `count().filter(cond)` — a method on every aggregate's result.
- **Ruling (i).** The builder's convention is "expressions are
  functions"; `over` already takes exactly this shape, and a wrapper
  needs no brand on sixteen constructors. Composition reads as SQL:
  `over(filter(count(), cond), spec)`.

## Q2 — Variant or field

- (i) `FunctionCallNode.filter?: ExprNode`.
- (ii) A new `AggregateFilterNode { fn: FunctionCallNode; where: ExprNode }`.
- **Ruling (ii).** D104's measurement stands: a field on the shared
  node is enforced by nothing (the codec's closed literal drops it
  silently, and a column default with a `filter` becomes representable),
  a variant is enforced by every mapped-type registry, `reachable-kinds`
  and the D70 completeness assertion. The window node's `fn` widens to
  `FunctionCallNode | AggregateFilterNode` so the SQL order `filter …
  over …` is the only representable one; `filter` over a window node is
  refused (the reverse order is not SQL).

## Q3 — What `filter` accepts

Builder aggregates only, decided at build time by the aggregate
read-shape vocabulary's own key set — `AGGREGATE_READ_SHAPES`, the
window-only half of the same table excluded, since the whole
`BUILDER_READ_SHAPES` key set also holds the eleven window-only names
and would admit `rowNumber()` (a schema-qualified `db.fn` call is a user
function, never the builder's): anything else fails with
`filter-not-aggregate`, naming the five constructors. The condition
takes the `Condition` type `where` takes; literals in it are lifted
like every other condition's.

## Q4 — Snapshot and read shape

New token `aggregate-filter`, strict decode (a node kind introduced in
the current version), no `formatVersion` bump (D73: vocabulary, not
shape). The read-shape lookup unwraps a filtered call to its inner call
on both the cast and the revive side, exactly as a window node is
unwrapped, so #452's ratchet covers it by construction.
