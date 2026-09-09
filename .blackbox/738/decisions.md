# Decisions — quickstart-now/hejbro#738

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — A core-built SetOpStage carries both branch stage types; ExecuteResult folds them with SetOpResult

_lead · extension · basis 412/D24, D25; the chain's own resolve-then-union rule (db/chain.ts); the query-type-inference requirement's stated carve-out; openspec MODIFIED cannot drop scenarios (REMOVED+ADDED) · 2026-09-05T08:14Z · ratified: pending_

Design (design.md Q1-Q4): SetOpStage<TProjection, TLeftStage = unknown, TRightStage = unknown>; combinators fill the stages, orderBy/limit forward them; @hejbro/query resolves each branch's row (own left-joined tracking, nested stages recursively) and unions with SetOpResult; unknown branches keep today's left-projection fallback; with.ts/chain.ts one-argument uses stay valid by default. Recursive CTE anchor/term typing out of scope. query-type-inference requirement REMOVED + ADDED. Ratification: owner on return.

<a id="r2"></a>
## R2 — the nesting scenario reads direction-neutral, the recursive term stays a #942 boundary, and 1.2-1.4 split per D88

_lead · interpretation · basis R1, 412/D24 · 2026-09-09T00:26Z · ratified: pending_

Approved before code, on the planner's request with the reviewer's pre-diff coverage findings: (1) the ADDED requirement's nesting scenario reads direction-neutral — a core-built set operation nesting another on either side, `(a union b) except c` and `a except (b union c)`, each side resolving through its own inner stage first — because the requirement's "each branch" is universal while two independent readers (design Q3, the first tasks table) had taken only the left case from the left-only example; (2) the query-layer reference's recursive-CTE paragraph keeps its behaviour sentence and corrects its rationale — the recursive anchor/term rule does not resolve a set-op stage's branches (#942, the untracked boundary), which this change makes reachable elsewhere; (3) the reference's set-operation paragraph replaces the core-built carve-out with the one rule, states both-side nesting, and says that a hand-written `SetOpStage<P>` annotation still resolves as the left branch's row with joins untracked (design Q2's fallback), and one clause distinguishes the stage's projection from the row `execute()` resolves so the `(#944)` sentence and the union sentence do not read as a contradiction; (4) task 1.2 splits under D88 into flat cases, nested-both-sides with all six combinators on the execute path, and docs. The piece measures whether #944 (a nullable right branch reading non-null) closes on this change; if it does the PR closes it and the reference drops the citation, otherwise the surviving surface is stated on the issue. Interpretation of the approved proposal; owner ratification queued with the proposal itself (delegation 412/D23).

<a id="r3"></a>
## R3 — SetOpCombinators is an interface so the combinators can return this as the left branch stage

_lead · extension · basis R1 · 2026-09-09T00:26Z · ratified: pending_

Task 1.1 settles how a core-built set-operation stage carries its branches. The piece measured the two exact shapes: threading the branch stage types as explicit generics is refused by TypeScript at the intersection's top level (TS2456, the type references itself), and a polymorphic `this` in a method's return position is accepted only on an interface or class (TS2526 on a type alias). Ruling: `SetOpCombinators` becomes an `interface` so each combinator can return `SetOpStage<TProjection, this, TOther>`, with `TOther` inferred as the whole branch object — which is what keeps the right branch's own left-joined tracking and a nested stage on either side intact without any further parameter. The house rule admits `interface` only where the language needs it; this is such a case (the `ObjectKind` precedent is the same kind), and the class ban's "no `this`" is about runtime binding — the objects stay plain values from factories and no method reads a runtime `this`. `SetOpCombinators` is not re-exported from the package barrel, so the interface's declaration-merging surface does not reach users; the piece records that as a measurement. A one-line comment on the declaration states the constraint. Interpretation of the approved proposal's design Q1/Q2.

<a id="r4"></a>
## R4 — the CTE reference is the fourth surface and closes in this piece as task 1.5, so #944 closes whole

_lead · extension · basis R1, 412/D29 · 2026-09-09T00:26Z · ratified: pending_

The piece measured #944 on four surfaces: core-built `handle.execute` (closed by 1.2), the recursive term of a recursive CTE (reads `| null`, the conservative #942 boundary, not #944's direction), a hand-written one-argument `SetOpStage<P>` (no value-level path reaches it), and `withCte().as("x", <set operation>)`'s reference reading, which still reads the left branch's unfolded projection — `string` where the right branch is nullable. The ADDED requirement says "the union of both on every surface", a universal sentence, and the CTE reference is a real value-level surface, so leaving it would ship a sentence the archive review can contradict with one input. Ruling: task 1.5 is added — `with.ts`'s `as()` resolves a set-operation stage's row by the same fold `execute()` uses (both-side nullability union, nesting on either side), the recursive-term path unchanged — with `with.ts` and its tests added to the group's file list under the tasks rule that any other file goes back to the planner. When the cell closes, the PR closes #944 and the reference drops its citation. Interpretation of the approved proposal's "every surface".
The planner split the work under D88 into 1.5 (code: `with.ts` and its tests) and 1.6 (the ADDED requirement's surface sentence gains the CTE body as a third surface and a seventh scenario; the reference drops the `(#944)` citation and states the fold on the `w.as` reference). The execution-value axis of 1.5 is the reviewer's to measure on a live server, since `@hejbro/core` is pure.

<a id="r5"></a>
## R5 — task 1.5 is declared nullability only, folds per branch through SetOpResult with the branch convention defined once in core, and proves one fold by mutation asymmetry

_lead · extension · basis R3, R4, 412/D29 · 2026-09-09T00:26Z · ratified: pending_

R4 (extension, lead, 2026-09-09) — task 1.5 is scoped to declared nullability, splits into 1.5a/1.5b (D88), and folds the CTE read of a set-op stage per branch. Naive folding inside `CteRowEnvironment` collapses the whole-table path to `CteFieldRef<unknown>` (its `TableColumns` reverse inference assumes one source; a folded synthesized object is a union of differently-branded values). Path B — compute each branch's environment, then combine per key with `SetOpResult`'s rule (no second fold; the piece's test pins CTE read type ≡ execute() row type per key) — reads `string | null` for whole-table and object projections alike, leaves the single-source branch and the recursive-term path untouched, and changes no runtime (`buildCteRowEnvironment` already reads only the left branch's projection input). A reduced scope (object projection only) closes nothing: the #944 original case is whole-table (W5). Merge form is `CteFieldRef<L | R>` — one reference per key, mirroring `SetOpResult`'s per-key value union — unless a compile constraint forces the union of references. Out of scope: nullability a branch acquired by left-joining does not reach a CTE reference at all — `CteRowEnvironment` carries no `TLeftJoined`, single-branch entries included (P3/P4, WNN) — a pre-existing boundary of `w.as`, not something the fold introduced; first filed as #1053 and re-triaged won't-fix by design: the spec names a CTE body as an untracked position, so an object-projected column already reads back widened and a whole-table column cannot come from a left-joined table. The seventh scenario defers to "A CTE reference carries its query's row type" for how each field reads back and states only the fold; the non-vacuous test axis is the declared read type for object projections and nullability for whole-table entries. Basis: R3 (same fold on both surfaces), D88 (>10m splits), D29 (every discovered issue gets a verdict), measurements P1–P4 (WNN). Ratification: queued for the owner.

<a id="r6"></a>
## R6 — Two delta sentences qualified after D106 round 2 (N1 scenario surface, N2 migration note)

_lead · interpretation · basis D106 round-2 report N1 and N2 (dev 35af6b16); 738/W2 with-body rule · 2026-09-09T05:06Z · ratified: pending_

Two delta sentences are qualified after D106 round 2 (dev 35af6b16, verdict ARCHIVE, N1 and N2), before the archive rolls them into the main spec.

N1: the scenario *A left-joined branch widens the core-built result, an inner-joined one does not* had no surface in its WHEN, and its THEN ("a projection no branch left-joined is not widened to include null") is contradicted on the `handle.with` body position, where the requirement's own fourth paragraph prescribes that position's untracked read (an object-projected column widened). Measured: `t_wb_obj_nn_nn` and `t_wb_inner_inner` read `null`-widened on the with body while `t_ex_obj_nn_nn` and `t_ex_inner_inner` read exact through `handle.execute`; the plain-body controls read the same widening on both builds. Ruling: the scenario's WHEN names `handle.execute`, and its THEN states in a parenthesis that the with body reads by that position's rule. The requirement paragraph is unchanged; the build follows it.

N2: the REMOVED block's migration note said "every other caller is unaffected", but a consumer that annotated a CTE-reference column over the set operation as `number | null` compiles on the parent build and fails on the corrected one (`src/consumer/cteref-narrowed.ts`, TS2322 bigint), because the reference's column widens with the fold. Ruling: the note names that consumer beside the awaited row, with its example.

Kind: interpretation. Both edits narrow a sentence to what the build was measured to do; neither changes the contract the owner approved (the fold on every surface, the with body under the untracked rule per 738/W2). Owner ratification queued with 738/W2's with-body rule.

