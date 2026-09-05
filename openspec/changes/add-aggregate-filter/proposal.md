# Proposal: add-aggregate-filter (#501)

## Why

Postgres's `FILTER (WHERE …)` clause applies to every aggregate —
`count(*) filter (where …)`, `sum(x) filter (where …)`, `avg(x) filter
(where …)` — and the builder has no constructor for it. The one narrow
spelling it once had (`countWhere`) was removed because it borrowed
`FILTER`'s meaning under an invented name; the requirement now says a
filtered aggregate goes through the `sql` escape hatch "until a real
`FILTER` construct ships". An escape hatch loses what the builder gives
every other aggregate: the declared result type, the runtime conversion,
rename retargeting inside a view body, and parameter lifting.

## What Changes

- **One wrapper, `filter(aggregate, condition)`.** Applies to any
  builder aggregate (`count`, `min`, `max`, `sum`, `avg`), returns the
  same typed expression the aggregate returned, and renders Postgres's
  own `<aggregate> filter (where <condition>)`. A window over a filtered
  aggregate composes as SQL does: `over(filter(count(), cond), spec)`
  renders `count(*) filter (where …) over (…)`. The condition accepts
  what `where` accepts; a runtime value in it is lifted to a bind
  parameter like every other condition.
- **A new expression node, not a field.** The filtered call is its own
  `ExprNode` variant carrying the aggregate call and the condition, so
  every site that walks, renders, encodes, retargets or lifts an
  expression is forced by the type to handle it — the enforcement the
  window node bought and a field on the shared function-call node would
  not. The window node's function slot widens to admit it. The snapshot
  token is new vocabulary (`aggregate-filter`), decoded strictly, and the
  format version does not move.
- **Placement Postgres refuses is refused at build time**: `filter`
  over anything that is not a builder aggregate (a plain column, a
  declared `db.fn` call, a window function, an already-windowed
  expression) fails with a coded diagnostic naming what it accepts.
- **The filtered cell reads back as its aggregate**: the read-shape
  vocabulary reads a filtered call through its inner call, so casting
  and reviving inside a nested read are unchanged.
- The query-layer reference documents `filter`; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`query-builder`** — MODIFIED requirement: *Selects aggregate and
  group* (the `FILTER` construct exists; placement refusals).
- **`snapshot-format`** — MODIFIED requirement: *Stored query-node
  decode strictness follows the node's format provenance* (the
  aggregate-filter node is decoded strictly).

## Impact

A new `ExprNode` variant is enforced by every exhaustive registry in the
repository, so the impact is exactly the set of those registries plus the
runtime guards that narrow the same slots — enumerated here rather than
discovered one crash at a time.

- `@hejbro/core`: `expr/ast.ts` (the variant; the window node's slot),
  `expr/aggregate.ts` (the wrapper), `expr/window.ts` (`over`'s own
  runtime guard and `buildWindowNode`'s narrowed slot, which the type
  widening alone does not reach), `expr/render-sql.ts`, `expr/codec.ts`,
  `expr/expr-children.ts` (called on the render path by
  `collectColumnRefs`, so rendering depends on it), `expr/walk.ts`,
  `query/select.ts` (the nested-read cast reads through it), the D70
  completeness fixture, the barrel and its pin. `expr/retarget.ts` and
  `expr/read-shape.ts` need no source change — their generic fallbacks
  walk through `expr-children.ts` — and are covered by pins only.
- `@hejbro/query`: `compile/params.ts` (lifting through the variant —
  one of the two child-traversal tables restated outside core),
  `db/convert.ts` (reads through it).
- `@hejbro/supabase`: `validators/rls-uncached-auth-call.ts` — the second
  child-traversal table restated outside core (`ChildrenOfHandlers`);
  without its entry the package does not compile.
- `hejbro` (the user-facing package): `src/index.ts`'s value re-exports
  and `src/core-surface.ts`'s vocabulary — a new core value export that
  misses both is a type-only export there, so the wrapper this change
  ships would not be importable by a user at all.
- `skills/hejbro`: `references/query-layer.md`.

Lands after `harden-aggregate-vocabulary` (#452), which owns the
read-shape table this change extends.
