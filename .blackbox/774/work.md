# Work — quickstart-now/hejbro#774

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-core-derivations 1.3: same-identity changes survive the diff refinement

_2026-09-04T13:25Z_

Change `harden-core-derivations`, group 1, task 1.3 (commit 21784f27 on branch `fix-core-derivations`).

`packages/core/src/engine/diff-engine.ts`, `refineByDependsOnIdentities`: changes are grouped by identity into a local `Map<string, Array<KindChange>>` (push accumulator, the file's own `groupContiguousByKind` pattern), the waves run over the unique identity list, and each placed identity's group is flattened back out — so same-identity, same-direction changes travel as one unit, adjacent, in the order the kind reported them. `buildPredecessors` and `runWaves` are unchanged.

Measured: red first, with the first custom `ObjectKind` fixture in `diff-engine.test.ts` (`test-kind` with `dependsOnIdentities`, `control-kind` without; `diff` returns the node's own `reports`, node on the side each operation carries) — two creates for one identity came back as `[b#2, b#2]`, three alters as `[b#3, b#3, b#3]`, two drops as `[b#2, b#2]`, and the dependent-with-two-creates row lost `b#1` the same way: the exact overwrite-and-duplicate the issue describes; create+drop for one identity and the control kind already passed. 4 failed / 16 passed → 20 passed. `tsc --noEmit` RC 0, `check:bans` ok; one biome `noTernary` hit in the test helper fixed by an if/else helper. Pure work ~6 min against a 9 min estimate (implementer-stamped).

Ruling applied: preserve rather than refuse (the interface lets `diff` return any number of changes); contract stated in the new `snapshot-diff` capability (delta only; the spec file and its Purpose are the archive commit's).

