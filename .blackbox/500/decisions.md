# Decisions — quickstart-now/hejbro#500

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The recursive CTE's outward row type keeps the anchor's types and widens each key's nullability by the recursive term's

_lead · extension · basis 412/D24, 412/D25; the requirement's own measurement (null from the recursive term reaches the rows, pg_typeof stays the anchor's); STRICT (a type that lies is the one thing the type layer must not do); the set-operation result's existing per-key nullability OR · 2026-09-05T05:39Z · ratified: pending_

Design (design.md Q1-Q3): the anchor rule governs types (Postgres's 42804), not nullability (a dimension Postgres never resolves); widen the null dimension only, outward reference only (the recursive callback's reference stays anchor-typed); both builder and chain surfaces. query-type-inference: two MODIFIED requirements; the residue paragraph is replaced by the rule. Ratification: owner on return.

<a id="r2"></a>
## R2 — nullability is decided in @hejbro/query alone; core only carries the recursive term's projection

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

<a id="r5"></a>
## R5 — A new runtime export of core is classified where the barrel curation demands it, as engine

_lead · interpretation · basis R2 · 2026-09-05T13:49Z · ratified: pending_

The barrel curation (#471) requires every runtime export of
`@hejbro/core` to be classified vocabulary or engine, exactly once,
before it ships, so this change's `widenedByBrand` forces
`packages/cli/src/core-surface.ts` open. It is classified engine: the
type layer's phantom carrier between `asRecursive` and
`ProjectedColumnResult`, never assigned at run time, and nothing a
schema author or query writer types, so `hejbro` has no reason to
re-export it. `leftJoinedBrand` is vocabulary because a shipped spec
names it as reaching users through `hejbro`; no such sentence exists
for this brand, in the delta or in the skill.

The type-only presence table in `packages/cli/test/exports.test.ts` is
NOT extended: it is a selective smoke check, not a completeness
requirement, and no spec names `WidenedBy` or `RecursiveCteReference`
as a user surface. That file is not edited by this change.

This is not a contract change; it is a file the tests force open, the
same shape as 486/R8 on the bt piece. The classification's reason lives
as a one-line constraint comment beside the entry.

<a id="r6"></a>
## R6 — A set-operation recursive term stays untracked; the contract states the exception

_lead · interpretation · basis R3, R4 · 2026-09-05T15:02Z · ratified: pending_

Review B1 found the delta's universal sentence -- a key non-null in
both branches stays non-null -- broken when the recursive term is a set
operation: every key of such a term reads nullable. The code is right
and the sentence was incomplete. A `SetOpStage` carries no left-joined
brand, so its set is UNKNOWN, and this repository's frozen contract
reads an untracked position as nullable; `never` would assert an empty
set nobody measured and would drop a real left join hiding inside a
set-op branch, which the reviewer measured on postgres:17 as a genuine
NULL.

The delta's THEN clause and the skill's CTE sentence therefore carry
the exception explicitly, and the reviewer's B1 input is pinned as a
row of the query table with that sentence quoted beside it. The
lead's first instruction (carry `never`) is withdrawn on the
reviewer's soundness warning.

Review N1 is settled with it: "the same per-key union a plain set
operation's result already has" was false -- a plain set operation
keeps the left branch's projection -- and is corrected in the delta,
the proposal, the design ruling and the skill. The gap that comparison
accidentally revealed (a plain set operation's own result type never
carries the right branch's nullability) is the lead's #944, sibling of
#932 and #942.

<a id="r7"></a>
## R7 — A nested-read key widens too; the widening is unioned where the nested read resolves

_lead · interpretation · basis R2, R6 · 2026-09-05T15:02Z · ratified: pending_

Review B2 and review E7/E8 are two ends of one asymmetry, and this
ruling closes both inside `packages/query/src/types/select-result.ts`.
Where `NestedOrExprResult` resolves a `NestedReadMarker` it returns
before `ProjectedColumnResult` is consulted, so a nested-read key never
read the `WidenedBy` brand: a recursive term projecting a nullable
value left the outward key non-null while the server delivered `null`
(measured) -- the narrowing the delta's SHALL exists to remove. The
widening is therefore unioned at that branch too.

The same type must not answer the other half. `ProjectedColumnResult`
does not know the nested-read rule and calls a `jsonArrayFrom` value
nullable, though it renders as `coalesce(json_agg(...), '[]')` and
cannot be null; resolving the recursive term's own value through
`NestedOrExprResult` instead keeps `jsonArrayFrom` non-null,
`jsonObjectFrom` nullable by its own rule, and ordinary columns on the
`ProjectedColumnResult` path. One layer only: the widening never
re-enters itself. Nullability keeps one source of truth (R2) --
`NestedOrExprResult` is that type's dispatcher, not a second rule.

The current SHA already violates the delta for the E11a shape (a
`notNull` non-json anchor value with a `jsonArrayFrom` recursive value
reads `| null`), so the fix closes a live defect, not only a predicted
one. The regression table carries rows in both directions, since a
table of null expectations alone cannot catch over-widening; and a
non-null row is never stated over a json column, whose read type is
`unknown` regardless of `notNull`.

The evidence first cited (an E8 shape over a json column) was a
measurement artifact -- a json column reads `unknown` regardless of
`notNull` -- and is replaced by E11a; the reviewer caught this himself.

<a id="r8"></a>
## R8 — Nullability is answered by the value's own rule, wherever the value is used

_lead · interpretation · basis R6, R7 · 2026-09-05T15:20Z · ratified: pending_

A recursive term's set-op branch carries no tracked left-joined set, so
a key it projects from a column, or from an expression that is not a
nested read, reads nullable -- the untracked rule. A key it projects
through a nested read does not: that value's own rule answers instead,
as it does everywhere else. `jsonArrayFrom` renders as
`coalesce(json_agg(...), '[]')` and is structurally never null;
`jsonObjectFrom` is `... | null` by its own rule. The delta's exception
clause is written this way, exclusively, rather than as "every key",
so a later review can falsify it with one input instead of reading it
as a slogan.

Measured: the reviewer ran the statement this change emits and the key
came back `[]`, never null, even with no child rows. E2 (a `union`
over a `json` column) is refused by Postgres -- "could not identify an
equality operator for type json" -- so the row is stated over
`unionAll` instead; hejbro accepting that `union` at build time is a
pre-existing gap tracked separately as #952.

