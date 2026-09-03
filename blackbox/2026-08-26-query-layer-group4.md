# 2026-08-26 — add-query-layer group 4: execution + driver contract (piece team g4)

Refs:
- packages/query/src/driver/contract.ts @ blob 1cfff5dea92332b682faccde28b8c0c52ed21e4a
- packages/query/src/driver/errors.ts @ blob ce847af9811bac2ba972907703c5f061de666cf8
- packages/query/src/db/db.ts @ blob e3f72783d37df223d4211c0f716c4388871eec46
- packages/query/src/db/execute.ts @ blob 6cd9778e349685c5cf80bc5b36e5e395369647b7
- packages/query/src/db/convert.ts @ blob 6d9c8ee409428ca04efdf56daf34cd87c2b573ca
- packages/query/src/db/context.ts @ blob a83e32589c4ece82653c167da2da28e51cacb1c0
- packages/query/src/db/transaction.ts @ blob fe7e6bc6edf3b4cb89929a936db655bc5192c0c0
- packages/query/src/db/fn.ts @ blob 6da2af1a44a166956bf1eaa3954375a60e17501b
- packages/query/src/db/fn-types.ts @ blob 9080eb3815d15db79b034d39f82ec828c4a9f8c3
- packages/core/src/dsl/define-function.ts @ blob 192a64216d447f0c493a41feabb69f2e1356c5fb
- packages/core/src/query/mutate.ts @ blob 6e919a0b152ded93e06ca8970e8e556832dd2c4b
- openspec/changes/add-query-layer/specs/driver-contract/spec.md @ blob 7184fd7e2ee8367328496a06a27268aa983cf1e4
- openspec/changes/add-query-layer/specs/query-execution/spec.md @ blob 966fe62e7a4e79cf08dcf6bbaf333080910e9b11
- openspec/changes/add-query-layer/specs/rls-execution-context/spec.md @ blob 5bf14dbe335113409f4029f7c4b7af98ccc8a1e9
- openspec/changes/add-query-layer/tasks.md @ blob 63bb656ec23e9e3320da6565e8c5b09003a391ed

Session: Claude Code (Fable 5) as lead; piece team g4 (planner: Opus,
implementer: Sonnet, reviewer: Opus). Owner inputs are English rewrites
of Korean originals; team decisions reached the owner only through the
lead. Final SHA `f4d57a8`, verdict PASS, zero open defects, zero open
decisions.

---

## Owner inputs and decisions in this piece

Group 4 started with its `[design]` decisions **pre-settled in the
tasks.md group header** — the direct application of group 3's measured
lesson (the cost was coordination, not implementation). It worked: all
four owner decisions that did arise mid-piece were absorbed in parallel
with other batches, and every ledger row shows `waited_user_min = 0`
because **no task ever stopped to wait** — not because waits were
hidden.

The four mid-piece decisions:

1. **`db.fn` static typing needs core (task 4.10 blocker).**
   `defineFunction` erased its args/returns types, so no query-side
   typing could exist without touching core. Owner chose **(B): core
   additive generic extension** — `FunctionDeclaration` gains defaulted
   type parameters; non-generic consumers compile unchanged (proven by
   first-try unchanged compilation of all three).
2. **Mutation `returning` typing** — same shape, owner chose **(a)**:
   generic type surface on core `mutate.ts`, runtime untouched.
3. **`db()` argument shape = (c′)**: a flat schema-module record;
   declarations are auto-collected by `declarationKind`, roles join
   validation only via an explicit `roles: [...]` opt-in. The
   owner-rejected (b) (name-based collection) died on the reviewer's
   fixture analysis: a typo'd export name would silently drop a role,
   making typo rejection probabilistic. The (c′) tsdoc must carry the
   *reason* string exports are not collected as roles — conclusion-only
   comments invite the next person to "improve" it back to (b).
4. **`db.fn` arguments = named object** (`db.fn.searchByStatus({
   status, limit })`), owner picked (A) after a full-UX comparison.

## What the piece built

Driver contract with an **exhaustive capability `Record`** (an
undeclared capability is a type error, not a falsy read; mandatory
prerequisites are not capabilities; `false` is fail-closed) and the
error contracts settled by the owner earlier: `query-execution-failed`
carries SQL text in the message but **params never appear anywhere**;
`result-conversion-failed` names the column; `undeclared-role` lists
the declared set; nested transactions fail with
`nested-transaction-unsupported` (savepoints parked as #313).
`db.as(context)` validates roles against the union
grant∪policy∪exported-roleName∪driver-contributed, quotes via
`quoteIdentifier` only, and applies settings through parameterized
`select set_config($1,$2,true)`. `db.fn.*` resolves scalar functions
to a value, not rows, and a silent scalar fallback was replaced by
fail-fast — which made the untyped-scalar path unreachable and
*tightened two types for free* (the piece's fourth and last
"type-was-lying" case closed by fixing behavior, not annotating it).

Review inversion of the spec surfaced **two requirements no task
owned** (typed rows for `execute`, `db.fn` static typing). Without
that back-derivation the group would have closed "complete" with four
spec SHALLs unimplemented.

## The seven "green but unverified" patterns (reviewer's wording, attributed)

All seven occurred while five to seven gates were green; none was
catchable by any gate. Kept verbatim as the piece's core yield:

1. **Vacuous assertion** — comparing a field, but only in cases where
   it is always empty (`params: []` in all three statements). (batch A
   FAIL; the piece's only pure-discipline rework, 1.3m)
2. **Loose type match** — `Record<string, unknown>` matches nearly any
   shape; without exact-match plus no-excess-keys the assertion is
   meaningless. (implementer, self-corrected: the strict-subset fixture
   leaked one direction via width subtyping → replaced with disjoint)
3. **CRAP drop ≠ verification gain** — splitting a branch clears the
   threshold without adding a single assertion; the number is a pass
   condition, not evidence of quality.
4. **Implementation without a requirement** — code exists, no
   production caller (`convert.ts` was unit-only until `4.4-wiring`);
   coverage and CRAP both green, so gates are *in principle* blind to
   it. (implementer, self-found)
5. **Post-hoc justification in contract documents** — when a spec or
   tasks.md sentence is widened to cover an implementation's drift,
   spec and code agree and no later review can catch it. It actually
   happened: 4.10 was once closed by redefining its scope in tasks.md;
   reopened, and 4.8 (spec deltas) was deliberately sequenced last with
   two-way drift checks against the owner's original wording.
6. **Name-based proof of absence (the verifier's own version)** — the
   reviewer concluded "no function cases in goldens" from a directory-
   name grep, then self-refuted; it would have excluded the *only* byte
   evidence for 4.11-mutation's harmlessness. Included at the
   reviewer's own request: without it the list reads as "implementer
   traps", when the real subject is misalignment between the observing
   instrument and the observed.
7. **Accidental equivalence (implementer, self-found)** — a mutation
   probe stayed green and the first instinct was "weak test", but a
   *different path was independently producing the same observable*.
   The first six are "the assertion doesn't catch it"; this one is
   "the assertion catches something, but not what it aims at" — it
   defeats mutation probing itself. The fix is fixture isolation, not
   stronger assertions.

> Green does not mean "passed"; it means "nothing was looking."

Two operational lessons, separate from the patterns (reviewer, at
dissolution): **baseline pre-capture is a precondition of judging** —
capturing base-green during idle time deleted the entire
"pre-existing vs new failure" reconciliation from every batch; and
**pattern 7 applies to citation too** — the evidence a verifier picks
can itself be "same observable, different cause" (the reviewer once
credited the wrong test for an observation; the planner caught it), so
even cited evidence needs a mutation check.

## Precedent ruling (§5): the core "type-surface only" rule binds by intent, not letter

`mutate.ts`/`define-function.ts` contain runtime-text changes (a
`unique symbol` anchor declaration, a `const stage` + cast). The
reviewer flagged them, declined to FAIL, and asked for a ruling; the
lead and planner upheld it. Decisive argument: a `unique symbol` type
cannot exist without a value declaration, so a literal reading makes
the owner-directed work (B)/(a) impossible. The rule's target is
"changing behavior under cover of type work", not declarations
intrinsic to making a type hold. Grounds recorded: no new statements,
branches, or value changes; identical in form to g3's
`columnMetaBrand`; behavior invariance proven by three green
harmlessness branches (core suite incl. goldens, examples chain SQL,
unchanged compilation of non-generic consumers). Kept as precedent —
the same question will recur, and it was answerable only because the
reviewer escalated with grounds instead of ruling silently.

## Incidents

**Raw NUL byte** (`f4d57a8`, 10m same-direction rework): an
adversarial test marker containing a literal `\0` turned
`context.test.ts` — the piece's most security-sensitive test file —
binary. Measured damage, not hypothetical: `git diff` showed
`Bin 0 -> 12340 bytes` (invisible in PR review) and plain `grep`
found 4 of 19 real matches. Functionally green throughout; replaced
with the `\u0000` escape, byte-identical semantics, file back to text.

**Backup loss, self-reported and independently closed**: the
implementer lost a `convert.ts` state mid-wiring, restored it, and
self-reported. The reviewer verified the restoration three ways —
diff shape (one test file +10/-0, no `src/` change), content
(`convert.ts` diff zero lines), and behavioral cross-check (all gates
green without mutation ⇒ a loss would have been red). Policy held:
self-reporting is never penalized, and the reported outcome is still
verified mechanically.

## Measurement notes (ledger)

Implementation 177.9m (core tasks 95.3m vs 142m estimated = **67%**;
five NEW rows 30.8m for review-inversion/self-found incompletions —
explicitly `not rework`; process costs 37m in eight named rows; rework
2 rows, both same-direction repairs, **zero re-analysis reworks**),
review 24.9m, prep 29m kept as an undistributed `4.prep` row. Three
derivation methods coexist and are tagged per row — `measured`
(batches A/B, live timestamps), `commit-interval approx` (batch C,
after a compaction lost live notes; approximations that inflated up to
9× against known measurements were corrected back), `step-based
estimate` (one row, where the commit interval contained judging waits
— the implementer refused to let wait time masquerade as rework time).
The tags must survive: a future estimator has to distinguish method
variance from difficulty variance. Tokens: 2,667 requests, 2,206,258
output tokens across the three role sessions, 99.5% cache hit.

## Handover kept

Uncovered branches → #315; `ExecuteResult`'s documented imprecision
(un-`returning()`'d mutation) stays tsdoc'd; group 7 must not re-export
the test-only symbols (`resolveColumnState`, `columnPlanForResult`,
`convertRow`, `ColumnPlanEntry`); parked: #307, #308, #313.
