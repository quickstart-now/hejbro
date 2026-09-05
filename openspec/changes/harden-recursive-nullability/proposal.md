# Proposal: harden-recursive-nullability (#500)

## Why

A recursive CTE's row type is the anchor's: Postgres resolves every
column to the anchor's type and refuses a recursive term that does not
(`42804`). hejbro's compatibility test therefore elides nullability
when it compares the two branches — and then types the CTE's outward
row as the anchor's, nullability included. That second step is not
Postgres's rule; it is hejbro's own inference, and it is wrong: an
anchor projecting a non-null value beside a recursive term projecting a
nullable one compiles, the CTE reads back as `number`, and the recursive
term's `null` genuinely arrives in the rows (measured on `postgres:17`,
`pg_typeof` staying `integer` on every row). The requirement records
this residue as a known unsoundness and leaves the trade-off open. The
STRICT rule of the type layer — never a type that lies — settles it.

## What Changes

- **The outward row type widens by the recursive term's nullability.**
  For every key, the CTE's row type stays the anchor's *type* and
  becomes nullable when either branch's projection is nullable —
  exactly what a plain set operation already does for its result. The
  compatibility test is unchanged (nullability elided), and the
  reference the recursive term is written against stays typed from the
  anchor alone, so the recursive term still sees the anchor's columns
  with the anchor's types.
- **Both surfaces agree**: the core builder's `asRecursive` and the
  query package's chain form widen identically.
- The user-facing skill's CTE section states the rule; one `patch`
  changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`query-type-inference`** — MODIFIED requirements: *The
  recursive-term reference is typed from the anchor* (the outward row
  type: anchor's types, nullability widened) and *Recursive-term
  nullability is elided, and the residue is stated* (the residue is
  closed; the scenario's THEN reads back nullable).

## Impact

- `@hejbro/core`: `query/with.ts` (`asRecursive`'s outward reference
  type) and the type tests beside it.
- `@hejbro/query`: `db/chain.ts` (the chain's recursive form) and its
  type tests.
- `skills/hejbro`: `references/query-layer.md`, the CTE section.
