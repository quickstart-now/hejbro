# Proposal: harden-set-op-families (#503)

## Why

`SetOpResult` — the compatibility test every set-operation combinator
and a recursive CTE's anchor/term pair share — compares key sets only.
A `text` branch against a `numeric` branch under the same key
type-checks today and fails on the server: `UNION types text and
numeric cannot be matched` (`42804`, measured while settling
harden-query-surface 6.2). Unlike the key-order gap (which the server
does not catch and #487 closed), this is a loud late failure worth
moving to build time. It is filed apart from #489 on purpose: #489 is
divergence *within* a family (`int`/`bigint`), invisible at family
granularity by construction, and a family rule must not read as having
closed it.

## What Changes

- **Branches must agree in type family, key by key.** `SetOpResult`
  resolves `never` — so the combinator's parameter poisons at the call
  site exactly as a key-set mismatch does — when the two branches'
  families for one key differ and the pair is one Postgres refuses to
  unify. `"unknown"` (a `sql` fragment, a literal the type layer cannot
  place) is a wildcard on either side: Postgres resolves an untyped
  expression against the other branch at parse time, and refusing it
  would make the builder stricter than the database.
- **The refused pairs are measured, not assumed.** A vendored table of
  the family × family matrix on `postgres:17` — which pairs the server
  refuses with `42804` and which it unifies through an implicit cast —
  is the rule's input; the spec states the class ("a pair the server
  refuses") and the measured table is the test's own input table.
- **Same rule on every surface**: core's combinators, the chain's
  combinators (they share `SetOpResult`), and a recursive CTE's
  anchor/recursive-term pair. The error is TypeScript's own, as today;
  no runtime check is added.
- Within-family divergence stays uncaught and the requirement says so,
  pointing at #489. The query-layer reference gains the rule; one
  `minor` changeset (`@hejbro/core`, `@hejbro/query` re-export).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`query-type-inference`** — ADDED requirement: *Set-operation
  branches must agree in type family*. No MODIFIED block: the
  key-compatibility requirement (being restated by
  `widen-set-op-execute`) is left untouched, so this change lands in
  either order with it.

## Impact

- `@hejbro/core`: `query/select.ts` (`SetOpResult`'s family test, the
  `"unknown"` wildcard, the measured pair table as a type-level
  constant), `query/with.ts` (the recursive-term compatibility test
  reuses it), type tests.
- `@hejbro/query`: `types/set-op.ts` re-export unchanged; chain type
  tests gain the family rows.
- `skills/hejbro`: `references/query-layer.md` (set-operation and
  recursive-CTE sections).

No overlap with `widen-set-op-execute` beyond `query/select.ts`, in a
different region (`SetOpResult` vs `SetOpStage`); sequence the PRs.
