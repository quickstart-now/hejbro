Refs:
- openspec/changes/harden-query-layer/design.md @ blob 10a6d3287311899691503118e3a334cc284ac93a
- openspec/changes/harden-query-layer/specs/query-type-inference/spec.md @ blob f0d581dba3dd3e10ee376b26819bec286193a30a
- openspec/changes/harden-query-layer/tasks.md @ blob 8d638dca9c82d9dea218a4699ee152ece7fa9168
- packages/core/src/expr/ast.ts @ blob d9714d8779c7db629c7d05740e6d861e6fd6ae53
- packages/core/src/expr/codec.ts @ blob f260ce2d64e551c30bd549ad1f2fab56a6d5a24b
- packages/core/src/expr/literal.ts @ blob 94e833740a53393ec596c753a49d9b41c4c80a5c
- packages/core/src/index.ts @ blob 04d6ef6befc1578940f79ea55abccf9ed09f3d0a
- packages/core/src/query/column-value.ts @ blob 35ff895ef6335e726cff6b21451140ed359db42d
- packages/core/src/query/mutate.ts @ blob 0c30e4a9293c56385664ba9a3655e3903f0484fc
- packages/core/src/types/array-literal-write.ts @ blob 6a0536e9ecca2b29de215c2196f60fb81862f32a
- packages/core/src/types/column-builder.ts @ blob bcd90958d9dcf76f6eee5c3ed9865db4516c613e
- packages/core/src/types/interval-serialize.ts @ blob 315f172c337c26ce04adb266c5b16c6e0c6e07a4
- packages/core/test/expr/literal.test.ts @ blob a4c04ebfea47569ab0fbb657d4702c9082c5d268
- packages/core/test/interval-serialize.test.ts @ blob 00721b5ba2fc71bfa6c79324459df073e8e24ec5
- packages/core/test/plpgsql/mutation-value-body.test.ts @ blob c8c9584c0abe160848a1ab9631e35eaf6875cd3d
- packages/core/test/query/column-value.test.ts @ blob ceedfa4d3d2829fed1d6bd81e95cbe2eba0c867c
- packages/core/test/query/mutate.test.ts @ blob 0f3d9ce983cfffb41bdcc757ef23c4d3a71fdbe1
- packages/core/test/query/snapshot-reachability.test.ts @ blob 51a383cdd6257c58996f9db9fbc3bdf40befd560
- packages/core/test/types/array-literal-write.test.ts @ blob 939b6a4d2f20ebe7c8bbdf4b560b92970b646557
- packages/query/src/compile/params.ts @ blob a66ea890261be880f40f9eef96bf52d4490e4817
- packages/query/src/types/column-map.ts @ blob 1109c4cc02a63162a693dbbf8cd97fd0dd6d8947
- packages/query/src/types/interval.ts @ blob 6b98af4681296ad99470554b3f1fdb5c82e740f5
- packages/query/test/compile/mutation.test.ts @ blob 0a74af6b0e7ffd605f60fee15d0bbeeeb9d3cd1d
- packages/query/test/db/chain.test.ts @ blob ea86c3924e89336168a9204fd1317822f37fc9ed
- packages/query/test/types/interval-serialize.test.ts @ blob 51bc3037eb4136efbe9dd4cf96d1c18325d77578
- packages/query/test/types/interval.test.ts @ blob c133825351524d8fac864697630c25813995acfe

# harden-query-layer group 2 — write-side value types

Piece team hg2 (planner opus, implementer sonnet, reviewer opus),
worktree `harden-g2-writes` off dev `0318d8a` via the settlement
commit `055b09f`, tracking issue #333, three consolidated commits
(tip `c519d69`, rebased clean onto dev `0a6fdee` as `71ba28d`) plus
this close-out. Issue #322; the last-landing group of the change.

## Owner decisions carried in

The two [design] tasks were owner-settled before the team was
summoned: STRICT write unions (the write type is the declared read
type exactly; convenience is a mode declaration, never a widened
union) and the always-full IntervalStyle-postgres serialization form.
Mid-group the lead ruled six escalations from the owner's settled
principles — serializeInterval lives in core (the D94 IntervalValue
precedent), STRICT applies only where a write path exists (json/jsonb
and bytea stay explicitly `never`, sql`` remains the escape hatch;
datetime narrows to `Date`, zero broken call sites measured), (F) new
literal kinds carry canonical text in the AST (JSON-serializability is
a global AST invariant — `JSON.stringify(1n)` throws inside the
plpgsql body-determinism guard, and core's own Date→isoValue precedent
was the answer), (D) parseInterval's `-0` on every zero subfield of a
negative time axis is normalized to `+0` (a live read defect — most
negative intervals hit it; the real-server anchor `-00:05:00` came
from group 1's docker harness), (E) the delta's round-trip sentence is
qualified "normalized within each axis", and the `$n::interval` cast
follows the `timestamptz` precedent.

## The boundary that held

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

## The stop finding, against this PR's own standard

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

## Ledger honesty

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
