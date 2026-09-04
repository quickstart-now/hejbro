# Work — quickstart-now/hejbro#322

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-query-layer group 2 — write-side value types

_2026-08-27T00:00Z_

Piece team hg2 (planner opus, implementer sonnet, reviewer opus),
worktree `harden-g2-writes` off dev `0318d8a` via the settlement
commit `055b09f`, tracking issue #333, three consolidated commits
(tip `c519d69`, rebased clean onto dev `0a6fdee` as `71ba28d`) plus
this close-out. Issue #322; the last-landing group of the change.

### The boundary that held

Adding literal kinds forces entries in codec's mapped types; filling
them symmetrically would have formally admitted the new kinds into the
snapshot grammar — a decoder legalizing kinds no producer makes, and
snapshot files are a file format whose widening is its own owner gate
(D87). The reviewer caught the trap while the planner's own coverage
instruction was pushing the implementer toward exactly that symmetric
fill; the keys are narrowed with `Exclude` so the exclusion lives in
the type, not prose, and the encode guard's message names the
consequence (a producer appearing means a snapshot format version
bump). Reachability is closed five ways, and the mutation re-adding
the `bigint:` key dies as a TS2353 — the spot that regressed three
times during the group is now locked by tsc, not vigilance.

### The stop finding, against this PR's own standard

The verdict's one stop was three reachable render handlers at 0%
coverage justified by a freshly written "unreachable in practice"
comment — in the very PR that promotes "a comment citing a constraint
expires with the constraint" to a handoff standard, a false
justification comment would have made the standard refute itself. The
fix took ten minutes (render assertions for all three kinds, the
comment corrected to name the real reach paths, per-kind mutations);
the group's own #7 unwarranted-scope line — "CRAP 0 violations is not
a quality guarantee" — got its live example, since the uncovered
handlers passed CRAP clean.

### Ledger honesty

Estimates: 44 nominal minutes for 2.1–2.5 against ~240+ measured, the
gap dominated by investigation and rework — the tasks.md file list had
not modeled core's lift layer at all (today's code could not write
bigint/interval/array values by any path, so the "widening" was
building the path). Eight of the fourteen mutation runs carry an
honest "pre-mutation green unverified" mark rather than a fabricated
step; the planner logged its own instruction slipping three times
(coverage vs invariant, FamilyOfTypeNode misuse that would have
silently blocked `text[]`, a mutation order covering one kind of
three) — each caught by a seat other than the instruction-giver, which
is the operating note it hands forward: reviews find the shortfall,
mechanical checks keep it from shortfalling again.

Migrated from the single-file entry `.blackbox/2026-08-27-harden-query-layer-group2.md`, kept verbatim at `.blackbox/322/artifacts/2026-08-27-harden-query-layer-group2.md`.

