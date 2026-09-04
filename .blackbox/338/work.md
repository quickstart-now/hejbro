# Work — quickstart-now/hejbro#338

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-inline-inference — bare inline factories stop widening their mode (#338)

_2026-08-27T00:00Z_

Plain-cycle bug fix (restores the mode-resolved read types the main
specs already promise — no proposal), executed by the re-tasked hg3
piece team (planner opus, implementer sonnet, reviewer opus) in
worktree `fix-inline-inference` off dev `fec58f9`, rebased clean onto
`5464786`. Tracking issue #338, filed by the lead into the phase gate
after the hg2 team's reconnaissance measured it during
harden-query-layer; the owner's same-day rule that 0.2.0 ships only
when every phase sub-issue is finished put it on the release path.

### The defect and the fix

A column declared inline with `bigint()`/`numeric()` whose argument
supplies no `mode` and which has no chained call inferred the full
union `string | number | bigint` instead of the mode-resolved default.
Characterization (fix withheld until it finished) established: the
trigger is contextual typing — `table()`'s parameter contextually
types the factory's return position and TypeScript back-infers `TMode`
from it, defeating the type-parameter default; `bigint({})` collapses
too, so argument presence was never the variable (the issue's rev 1
condition and its prescribed overload fix were both corrected on the
record — an arity overload would have left `bigint({})` broken and
changed the public `.d.ts`). Runtime was measured unaffected
(`columnState.mode` correct everywhere; the wrong type is wider than
the truth, never narrower), and the collapse propagates structurally
from the `table()` call into `SelectResult`, `ReturningRow`, and
`InsertInput` — one root, three symptoms, which became a verification
condition: one fix must heal all three or the root was misidentified.

The fix is `NoInfer<TMode>` at the four return positions of the two
factories carrying `NumericMode` — parameter positions untouched so an
explicit `{mode}` still narrows. Public surface unchanged; no
changeset. Established here: `NoInfer` blocks return-position
contextual back-inference on TS 5.9, though its documented use is
parameter positions — the standard cure for "generic default loses to
contextual inference".

### Evidence shape

The link-axis mutation (remove `NoInfer`) and the non-regression
transplant (run the new tests on pre-fix `fec58f9`) drew exactly the
same red set — core 4, query 6 — so "10 fixed, 11 preserved" was
cross-confirmed by two independent routes with zero label
misclassification. `.notNull()` chains (which the in-flight hg2 branch
depends on) are green on both sides of the fix. Goldens and examples
are byte-unchanged, matching the runtime-unaffected measurement. C19's
md5 anchor and the #310 concrete-type pins survived untouched.

### Process record

Three standards joined the piece-team handbook alongside the two from
group 3: (3) state a type measurement's frame as the type expression
itself — `BaseTsType<…>` and `SelectResult<…>["c"]` legitimately
disagree on the same declaration, and an unlabeled frame caused two
independent misreadings (both retracted, including a wrong
"frame-mixing" charge against hg2's accurate matrix — corrected on
#338 twice); (4) a mutation crossing a package boundary is void until
the dependency is rebuilt (tsc resolves `exports.types` to `dist`, so
the default is a false green — the gates are protected by
`dependsOn ["^build"]` from #287, raw `tsc` probes are not); (5) never
freeze while an instruction is still open — the planner froze early
twice, a reviewer completed a stale SHA, and the fixed
HEAD-equals-frozen-SHA check in the verdict procedure is what caught
it, so it is procedure now, not vigilance. The planner also
self-reported rationalizing away a missing `.unique()` control that
turned out to be the unique opposite-nullability pair to `.notNull()`
— overruled by the reviewer, kept. Time: 114m total, all implementer-measured (the planner
corrected its own 3m estimate to the measured 4m rather than let an
estimate sit in the ledger as a measurement), of which the fix itself
was ~5m — characterization and proof outweigh the edit twentyfold in
type-inference defects.

Migrated from the single-file entry `.blackbox/2026-08-27-fix-inline-inference.md`, kept verbatim at `.blackbox/338/artifacts/2026-08-27-fix-inline-inference.md`.

