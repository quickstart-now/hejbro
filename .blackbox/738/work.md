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

