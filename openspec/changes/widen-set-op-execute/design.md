# Design: widen-set-op-execute

Settled by the lead under the owner's full delegation for this pass
(412/D24, D25); recorded as R1 on #738 for ratification.

## Q1 — What the stage carries

- (i) The right branch's projection type only (`SetOpStage<TLeft,
  TRight>`), folding projections in core.
- (ii) Both branch *stage* types (`SetOpStage<TProjection, TLeftStage,
  TRightStage>`), folding rows in `@hejbro/query`.
- **Ruling (ii).** Core has projections, not rows: `SelectResult` (the
  declared-read-type resolution, left-join nullability included) lives
  in `@hejbro/query`, and folding must happen where rows are resolved —
  the chain already does exactly this ("resolves EACH branch's row type
  first, then `SetOpResult` unions the two RESOLVED row types"). Carrying
  the stage types keeps each branch's own `TLeftJoined` reachable, which
  (i) would lose again. Core's compatibility gate stays keyed on the left
  projection; nothing in core reads the new parameters.

## Q2 — Compatibility

Both parameters default to `unknown`. `ExecuteResult` matches the
three-parameter form and, when either branch is `unknown`, resolves the
left projection with untracked joins — today's exact result — so a
hand-written `SetOpStage<P>` annotation and every existing test keep
their meaning. Measured before the proposal: outside `query/select.ts`
and `db/db.ts`, the one-argument form appears in `query/with.ts` (a
CTE body, a recursive anchor and term accept `SetOpStage<TProjection>`)
and `db/chain.ts` (the chain's branch-node accessor) — each a parameter
position that the defaults keep satisfied by a three-parameter stage,
since the wider type assigns to the narrower. A recursive CTE's own
anchor/term union is out of scope here (it is a `WithStage` question,
not an `ExecuteResult` one).

## Q3 — Nesting

`(a union b) except c`: the outer stage's left is the inner stage; the
resolver recurses. Depth is bounded by the statement, not by a type
budget; the type test carries a three-level case.

## Q4 — Spec delta form

The requirement keeps its name's first half but two scenarios describe
behavior that ceases to exist, and a MODIFIED block cannot drop or
rename a scenario. REMOVED + ADDED, the ADDED text restating the
measured Postgres facts unchanged.
