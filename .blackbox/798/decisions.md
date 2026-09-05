# Decisions — quickstart-now/hejbro#798

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The wave tie-break is stated and pinned as implemented; a self-reference never blocks its own table

_lead · interpretation · basis 412/D24, D25; runWaves in engine/diff-engine.ts; measured create p_parent, self_ref, q_child and drop q_child, self_ref, p_parent · 2026-09-05T06:06Z · ratified: pending_

Spec-only pin: identity order within a wave, earliest wave for a satisfied object, self-reference non-blocking (measured: the first drop-side guess q_child,p_parent,self_ref was wrong; the test is the measurement). Lead-direct single-file piece; no code, no changeset. Ratification: owner on return.

