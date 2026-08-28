# Proposal: add-set-operations

## Why

`union`/`intersect`/`except` are the smallest of #299's three deferred
query-layer features and the one the other two lean on (recursive CTEs
require `union all`). The owner settled the decomposition and this
change's contracts in the 2026-08-28 brainstorm (D103): #299 splits
into three changes — set operations first — and set-ops land as a new
statement-node variant with type-enforced branch compatibility.

## What Changes

- **One new statement node**: `SetOpNode` — a `QueryNode` variant
  (`operator: union|intersect|except`, `all`, recursive
  `left`/`right`, whole-set `orderBy`/`limit`). Recursive branches
  express nesting (`(a union b) except c`); the whole-set
  `orderBy`/`limit` placement matches SQL's own. All statement-node
  propagation sites are compiler-forced. (#299's original "IR in
  `@hejbro/query`" wording predates the amended D94 — nodes and
  builders live in core.)
- **Chain combinators**: `.union()`, `.unionAll()`, `.intersect()`,
  `.intersectAll()`, `.except()`, `.exceptAll()` on the select chain
  (core builder + query chain alike), returning a post-combination
  stage carrying `orderBy`/`limit` for the whole set. `compile()`
  shows the exact emitted SQL.
- **Type-enforced branch compatibility**: mismatched branch row keys
  fail to type-check (the database would reject the statement — the
  STRICT family rule). The result row takes the LEFT branch's keys;
  each column types as the union of the two branches' declared types
  (identical declarations stay unchanged); nullability is the OR.
- **View bodies accept set operations**: `defineView` takes a set-op
  query, the snapshot codec round-trips the node (a new discriminator
  is vocabulary — no `formatVersion` bump, D73), and the view's
  column list and physical-order oracle resolve via the LEFT branch
  (SQL's own naming rule).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-builder`: the set-operation combinators, the emitted SQL
  shape, nesting, and the view-body/codec round-trip.
- `query-type-inference`: branch-compatibility enforcement and the
  result row typing rule.
- `query-execution`: set-op results convert per the LEFT branch's
  declared columns (one statement, existing conversion pipeline).

## Impact

- **Affected code**: `packages/core` (ast node + codec + renderer +
  walk/retarget/scope arms + builder combinators + view-kind/
  column-order left-branch resolution), `packages/query` (compile
  handlers, column plans, chain combinators, result typing),
  `packages/supabase` (the view RLS validator walks BOTH branches —
  either branch's bypass is a bypass), `packages/pg` integration
  witness, `skills/hejbro`.
- **Breaking**: none — additive throughout; `formatVersion` stays 7.
- **Decision log**: adds D103 (the five settled decisions and the
  #299 decomposition; D4/D5-class forks for window and CTE are parked
  in #416/#417's own proposals).
