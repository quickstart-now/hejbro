# Design: harden-recursive-nullability

Settled by the lead under the owner's full delegation for this pass;
recorded as a ruling on the change's issue.

## Q1 — Widen, or keep the residue stated

- (i) Keep the anchor's row type, nullability included, and keep the
  residue stated (the shipped state).
- (ii) Widen each key's nullability by the recursive term's; keep the
  type the anchor's.
- **Ruling (ii).** The rule "the row type is always the anchor's" is
  Postgres's rule about *types*; nullability is not a dimension Postgres
  resolves at all, so applying the rule to it was hejbro's own choice
  and a wrong one under STRICT (a non-null type over rows that carry
  nulls). Widening the null dimension only keeps the Postgres rule
  intact and removes the lie. It is the same shape the set-operation
  result already has (per-key union, nullability OR).

## Q2 — What the recursive term sees

Unchanged: the reference handed to the recursive callback is typed from
the anchor alone (the recursive term is written before its own type
exists, and Postgres types it from the anchor). Only the reference the
`with` body receives — the CTE as a source — carries the widened row.

## Q3 — Where

`asRecursive`'s return type in core (`query/with.ts`) computes the
widened projection from the anchor's and the recursive term's
projections; the chain form in `@hejbro/query` (`db/chain.ts`) carries
the same computation through its `CompatibleBranch` path. Runtime is
untouched: a `null` from the recursive term already arrives; the
conversion layer already passes it through.
