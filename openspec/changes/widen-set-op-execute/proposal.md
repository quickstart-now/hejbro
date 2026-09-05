# Proposal: widen-set-op-execute (#738)

## Why

The `query-type-inference` spec promises, for the chain surface, that a
set operation's result types each column as the union of both branches'
declared read types, and nullable when either branch is. The core
builder's own combinators cannot keep that promise: `SetOpStage` carries
the left branch's projection alone — no type for the right branch, and
no record of what either branch left-joined — so `handle.execute()` of
a core-built set operation resolves the left branch's row, and an
object projection is additionally widened to include null because the
join record is missing. `harden-query-conformance` (#737) wrote that
gap into the spec honestly rather than narrowing the chain's promise.
Closing it is a core combinator surface change and this change's whole
scope.

## What Changes

- **A core set-operation stage remembers its branches.** `SetOpStage`
  gains two type parameters, the left and right branch *stage* types,
  filled by every combinator (`select(a).union(select(b))` yields
  `SetOpStage<ProjectionOf<a>, typeof stageA, typeof stageB>`; a nested
  `(a union b) except c` carries the inner stage as its left). Whole-set
  `orderBy`/`limit` keep them. Both default to `unknown`, so every
  existing one-argument use of the type and every hand-written
  `SetOpStage<P>` keeps compiling; the runtime, the node, the rendered
  SQL and the key-order guard are untouched.
- **`execute()` folds the branches the way the chain does.**
  `ExecuteResult` resolves each branch to its own row — a select stage
  through `SelectResult` with its own left-joined tracking, a nested
  stage recursively — and combines them with `SetOpResult`: the left
  branch's keys, each column the union of both declared read types,
  nullable when either branch's resolved row is. A projection over a
  left-joined table is therefore nullable because that branch *tracked*
  the join, not because the record was missing — the "widened to include
  null" fallback disappears from the core-built path. A stage whose
  branches are `unknown` (a hand-written type) still resolves as today.
- The spec's set-operation typing requirement is restated without the
  core-built carve-out (REMOVED + ADDED, since two of its scenarios no
  longer describe the product); the query-layer reference drops the
  caveat; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`query-type-inference`** — REMOVED requirement *Set-operation
  branches must be row-compatible, and the result types honestly*;
  ADDED requirement *Set-operation branches must be row-compatible, and
  the result types the union of both on every surface* (the same
  requirement with the core-built carve-out gone and its two scenarios
  replaced by the widened contract).

## Impact

- `@hejbro/core`: `query/select.ts` (`SetOpStage`'s two new parameters,
  `SetOpCombinators`' return types, the stage factory), its type tests.
- `@hejbro/query`: `db/db.ts` (`ExecuteResult`'s set-op arm and a
  branch-row resolver), `test/*types*.test.ts`.
- `skills/hejbro`: `references/query-layer.md` (the set-operation
  section's core-built caveat).

No file overlap with any change in flight; `add-aggregate-filter`
touches `query/select.ts` only in the nested-read cast, a different
region — sequence the two PRs, either order.
