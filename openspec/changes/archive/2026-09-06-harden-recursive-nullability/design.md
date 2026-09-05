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
  intact and removes the lie. (Corrected under #500/R6: a plain
  set-operation's result does **not** union nullability per key — it
  keeps the left branch's projection, tracked as **#944** — so this
  rule is the recursive form's own, stricter than that one.)

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

A recursive term that is a `SetOpStage` keeps `UntrackedJoins` (#500/R6,
confirming R3): that stage type carries no left-joined set, and this
repository's frozen contract reads an untracked position as nullable —
"unknown" is not "empty". A key such a term projects from a column or an
expression that is not a nested read therefore reads nullable outward; a
key it projects through a nested read keeps that read's own nullability
instead (#500/R8 — the value's own rule answers wherever it is used),
and the delta's sentence states both halves. The pinned row for the
nested-read half is written over `unionAll`: `union` over a `json`
column is refused by Postgres ("could not identify an equality operator
for type json") though hejbro type-checks it, a pre-existing gap tracked
as **#952**. Claiming `never` there would assert an empty set
nobody measured and would drop a real left join hiding inside a set-op
branch. The exception disappears when **#944** closes — a plain set
operation's own result type carries only the left branch's projection
today, which is why a set-op stage has no set to hand over. Closing it
means computing that set instead of asserting one, and both regression
rows this change pins (a key non-null in both branches, and a
`notNull` column projected across a left join inside the set-op term)
flip to their computed answers then.

**Superseded in mechanism by #500/R2 and #500/R3**, not in outcome:
core carries the recursive term's projected value and its own
left-joined set on the outward reference (`WidenedBy`), and
`@hejbro/query`'s `ProjectedColumnResult` — the one place that resolves
a projected value's null dimension — does the widening. `db/chain.ts`
needs no change of its own: `ChainApi.with` takes core's `CteBuilder`
and resolves rows through `SelectResult`.

## Q4 — Visibility on the chain surface

- **Ruling (#500/R4).** The widening is stated and verified at the layer
  that decides nullability (`SelectResult`/`ProjectedColumnResult`, with
  the outward left-joined set given as `never`), not through
  `handle.with(...)`. `makeWithChain` resolves `SelectResult<TProjection>`
  with the untracked default, so every key of a `db.with(...)` row is
  already nullable today — a fact narrow-join-nullability's own
  absorption requirement states, and repeating it here would give it two
  sources of truth. This change makes the type true; making the chain
  surface show it is the separate change that narrows that absorption
  (**#942**, a sub-issue of #815 and a sibling of #932's anchor/view-body
  absorption).
