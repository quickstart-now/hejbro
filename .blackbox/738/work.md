# Work — quickstart-now/hejbro#738

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 1.5 P1-P4: CTE merge-shape spikes, observation-point correction, #1054 residue

_2026-09-08T20:22Z_

Task 1.5 (widen-set-op-execute) measurement spikes P1-P4, run before and
during the CTE-fold scope decision. Facts only, recorded here per the
lead's own instruction (these back R4, the merge-shape ruling, and the
follow-up issue).

**P2** (which shape the original #944 repro used): the case measured
`string` (non-null) in task 1.4's own (e)2 probe was **whole-table** --
`select(flagNotNull).union(select(flagNullable))`, not an object
projection.

**P3** (does the merge shape -- `CteFieldRef<L | R>` vs `CteFieldRef<L>
| CteFieldRef<R>` -- change whether a left-joined column's nullability
survives a CTE reference read): measured via `T`, `CteFieldRef<T>`'s
own carried value (see the correction below, not a resolved row).
Control (both branches inner-join only): both merge options read
`string` (correct, non-null). Test (one branch left-joins the
projected column's source table): **both** merge options read `string`
too -- neither carries the join. No difference between the two shapes
on this axis.

**P4** (is the P3 result specific to set-op folding, or a pre-existing
`w.as()` boundary): a plain, single-branch CTE entry (no set operation
anywhere) with an internal left join, read back the same way, ALSO
reads `string` (non-null); the inner-join control reads `string`
(correct). Same answer with and without folding in the picture --
confirms a pre-existing boundary, not something either merge option
introduces or could avoid.

**Correction (recorded after the scope decision moved past P1-P4):**
P3 and P4 both read `CteFieldRef<T>`'s own carried type parameter `T`
directly (`packages/core`, no dependency on `@hejbro/query`, so no
resolved ROW was ever measured in P3/P4) -- not a row read back through
`SelectResult`/`ExecuteResult`/`handle.with(...)`. The follow-up filed
from this measurement (#1053, "a CTE reference drops the nullability
its entry acquired by left-joining") was subsequently closed won't-fix
(by design): the query-type-inference spec's own existing rule (`A left
join is what widens a projected field's nullability`, lines 101-125)
already states that an object-projected field is widened at the
untracked position regardless of body, and a CTE body is explicitly
named among the untracked-carrying positions -- so no null the P3/P4
measurement's own `T` could hide is actually lost at the row level;
`T` was never the contract surface to begin with. Independently, a
SECOND observation-point artifact was found and retracted during the
same investigation: a comparison that appeared to show object-
projection nullability behaving differently used `SelectResult` with
its second argument OMITTED (defaulting to the untracked/fail-safe
position), which produced `| null` even for a control with no CTE and
no set operation at all -- an instrument artifact, not a real reading;
withdrawn once traced to the omitted argument.

**Independent finding (own investigation, feeds #1054, not this
change's own scope): a same-family, different-width divergence between
two branches (`integer` vs `bigint`) types correctly (the union) but
converts incorrectly at the value level** -- Postgres promotes the
column (`int4 ∪ int8 → int8`) and the codec selected from the LEFT
branch's own declaration no longer matches the value that actually
arrives, so a promoted column's rows arrive unconverted (raw driver
shape) on all three surfaces (chain, a core-built statement executed on
a handle, a CTE body). Measured with a same-declaration control
(isolates the divergence as the cause, not an unrelated regression).
Tracked separately as #1054 -- a value-level residue outside this
change's own type-folding scope.

<a id="w2"></a>
## W2 — D106 round 1: the db.with body folds a set-op body (B1), N1-N8 corrected, N9 observed

_2026-09-09T02:30Z · per R5_

D106 round 1 (dev a1fb7e7c) returned BLOCKED on B1: a set operation returned as the body of `handle.with(...)` read as its left branch alone (`select(nn).union(select(nul))` typed `note: string` while the server delivered `null`; `narrow ∪ wide` typed `number`) — a position that predates the change but which the ADDED requirement's "every surface … executed through a db handle" names. The piece had measured four surfaces (core execute, the recursive term, the hand fallback, the CTE reference) and missed this fifth one; lesson recorded: a universal "every surface" sentence lists its surfaces in the spec, and the reviewer's cells are drawn from that list. Lead-direct correction (#1067): `db.with` is now generic over its body; `WithBodyRow` folds a set-op body through the shared `SetOpResult` with core's branch convention (`SetOpStageBranches`, `IsUnfilledBranch` — a third consumer), each branch read the way the with position reads a plain body (untracked: object projections widened, whole-table columns at their declared nullability); a hand-written `SetOpStage<P>` keeps the fallback. Mutation asymmetry, with the core rebuilt between runs because the query package type-checks against core's dist: the shared fold off reddens with-body 4 / execute-result 11 / chain-types 1 together; the with fold alone off reddens 4 / 0 / 0. The four guard cells put the narrower branch on the left (the swapped order is a control that passes with or without the fold); the object-projection and hand-written-stage cells are anchors for the position's rule. N7 fixed in the same change (`[cteRowMeta]` stripped from rows read over a CTE reference — symbol keys are never columns). Text: the requirement names the with body and its rule and the `handle.execute(withCte)` boundary (N2 → #1055); the residue sentence now states both branch orders (N1 measured: narrow-left arrives raw, wide-left arrives converted inside the union); the REMOVED block's migration names the consumer that narrowed (N4); the CTE snippet returns a body select (N8); the reference carries the #942 caveat on the CTE section (N3), the spellable recursive-term shapes and their non-termination (N5), the family-only check (N6). N9's six observations need no action. Round-1 corpus: /private/tmp/d106-wso.

<a id="w3"></a>
## W3 — D106 round 2: ARCHIVE; triage (#1070, #1071), wording under R6, archive

_2026-09-09T05:06Z · per R6_

D106 round 2 (reviewer d106-wso-r2, fable, context-free; worktree `d106-widen-set-op-execute-r2` at dev 35af6b16 = #1062 + #1069; corpus `/private/tmp/d106-wso-r2/`, preserved read-only at `~/Documents/workspace/@quickstart/hejbro-review-corpus/wso-738-d106-r2/` beside round 1's `wso-738-d106-r1/`): verdict ARCHIVE, B 0, N 6.

Round 1's B1 is closed on the corrected build: 30 of 53 with-body cells changed against the parent-commit build, every change a widening from the left branch's own type to the fold; `null` arrives only under a type that allows it in every with-body cell except the hand-written `SetOpStage` annotations the reference documents. Round 1's 109 matrix assertions and 80 runtime cases unchanged (regression re-run from the round-1 corpus); 43 new assertions and 44 new with-body runtime cases clean; rendered SQL and every row value byte-identical between the corrected build and the parent commit's build.

Triage (412/D29): N1 (left-join scenario THEN vs the with-body rule) and N2 (migration note's "every other caller") are spec wording, corrected in the archive PR under 738/R6. N3 (core combinators refuse a whole-table branch beside an object projection with the same key set; the chain accepts and executes the pair; pre-existing) filed as #1070, verdict fix. N4 (`select(ref)` over a CTE reference type-checks as rows but `compile()` throws `missing-from-table`; pre-existing) filed as #1071, verdict fix. N5 (a hand-written `SetOpStage<P>` body hides a `null` or a raw string the inferred type shows) is by design per the reference; one sentence added to the reference ("Prefer the inferred type ..."). N6 observations (reference-column brands carry declared nullability; `enum ∪ text` refused by the server as documented (#977); `orderBy`/`limit` on the body; a left-joined recursive term with a depth guard terminates) recorded, no action.

Archive: round-2 report appended to `evaluation.md`; `openspec archive widen-set-op-execute` rolls the ADDED requirement into `query-type-inference` in place of the REMOVED one; record closed.

