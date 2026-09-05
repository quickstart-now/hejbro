# Decisions — quickstart-now/hejbro#500

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The recursive CTE's outward row type keeps the anchor's types and widens each key's nullability by the recursive term's

_lead · extension · basis 412/D24, 412/D25; the requirement's own measurement (null from the recursive term reaches the rows, pg_typeof stays the anchor's); STRICT (a type that lies is the one thing the type layer must not do); the set-operation result's existing per-key nullability OR · 2026-09-05T05:39Z · ratified: pending_

Design (design.md Q1-Q3): the anchor rule governs types (Postgres's 42804), not nullability (a dimension Postgres never resolves); widen the null dimension only, outward reference only (the recursive callback's reference stays anchor-typed); both builder and chain surfaces. query-type-inference: two MODIFIED requirements; the residue paragraph is replaced by the rule. Ratification: owner on return.

<a id="r2"></a>
## R2 — R2 — nullability is decided in @hejbro/query alone; core only carries the recursive term's projection

_lead · extension · basis R1 · 2026-09-05T12:39Z · ratified: pending_

The outward widening is expressed in two halves. `@hejbro/core`'s
`asRecursive` intersects a phantom `WidenedBy<TRecursiveValue>` onto
every key of the OUTWARD reference -- never onto the reference the
recursive callback receives -- and carries the recursive term's own
projected expression there unchanged. `@hejbro/query`'s
`ProjectedColumnResult` resolves both sides and unions the null:
`ProjectedColumnResult<E> | (null extends ProjectedColumnResult<R> ?
null : never)`, a mapped conditional type and so outside the ternary
ban.

Rejected: core deciding which keys widen (origin brand present, direct
column ref, `notNull`). That rule is a proper subset of the query
layer's null knowledge -- a recursive term projecting a left-joined
table's non-null column reads nullable there and non-null in the copy
-- so the outward row would widen too little, which is exactly the
lying type R1 exists to remove. Nullability has one source of truth and
it is already `ProjectedColumnResult` (D95: a second path has to stay
true a second time). Rejected too: dropping the origin brand, which
coarsens the field to the family read type and violates "the type stays
the anchor's"; and widening `exprNode` past `ColumnRefNode`, which
breaks `CteFieldRef`/`FromSource` assignability and overloads "not a
direct column ref" to mean "nullable".

Rejected as well: rewriting the origin brand's own `notNull` to `false`
in core. It plants a claim that is false about the declared table
column, it reaches the other consumers of that brand (`ColumnMapEquals`,
`.related`), and it keeps the deciding step in core, so it inherits the
same proper-subset defect -- a left-joined recursive projection stays
non-null.

Consequences: `packages/query/src/types/select-result.ts` joins this
change's file boundary. Task 1.1's red becomes the structural carriage
in core; the row-nullability table moves to 1.2 and gains the
left-joined row that decides the question. `packages/query/src/db/
chain.ts` is expected to need no source change, the chain taking core's
own `CteBuilder` rather than restating it.

<a id="r3"></a>
## R3 — The recursive term's own left-joined set travels with the widening carrier

_lead · extension · basis R2 · 2026-09-05T12:59Z · ratified: pending_

`WidenedBy` takes a second parameter, the recursive term's own
left-joined set: `asRecursive` infers it from the stage the recursive
callback returns, and `@hejbro/query` resolves the carried value as
`ProjectedColumnResult<R, TRecursiveLeftJoined>`. A recursive term that
left-joins nothing carries `never`, the tracked empty set, so a key
non-null in both branches stays non-null; one that projects a
left-joined table's non-null column carries that table, so the key
reads nullable outward; one that is a set-op stage carries no set at
all and falls to `UntrackedJoins`, widening every key -- the fail-safe
direction.

Reading an absorbed left-joined set here does not contradict
`select.ts`'s own absorption note: that note forbids NARROWING on a set
a position did not earn; this reads it only to WIDEN.

Rejected: dropping the left-joined row and stating it as residue. R2
rejected a core-side nullability rule precisely because it loses
left-join knowledge, so leaving the same loss inside the O1b
implementation would leave R2's own rationale unrealized.

Boundary: the anchor's own left-joined set stays absorbed, unchanged by
this change and pinned by none of its tests -- a pre-existing gap
tracked separately under #815.

<a id="r4"></a>
## R4 — The widening is verified at the layer that decides nullability, not through the chain surface

_lead · interpretation · basis R2, R3 · 2026-09-05T13:19Z · ratified: pending_

The 1.2 table is stated over `RecursiveCteReference` and
`SelectResult<{...}, never>` -- the outward left-joined set given
explicitly as the tracked empty set -- rather than through
`handle.with(...)`. `makeWithChain` resolves `SelectResult<TProjection>`
with the untracked default, under which every key of a `db.with(...)`
row is already nullable, so the rows that must stay non-null could not
be stated on that surface at all and the table would test nothing.

The delta says nothing about this. Its sentence -- the outward row is
the anchor's type, nullable when either branch is -- is true and
verified at the layer that decides nullability, and today's
all-nullable chain reading is what narrow-join-nullability's own
absorption requirement already says; repeating it in this delta would
give one fact two sources of truth. The boundary is written in tasks.md
1.2, in design.md's Q4, and in the user-facing skill's CTE section
instead.

This does not contradict R2's rejection of a core-side rule for
widening too little. Making the type true at the deciding layer is this
change's work; making the chain surface show it is the separate change
that narrows the absorption, tracked as #942 under #815, a sibling of
#932.

