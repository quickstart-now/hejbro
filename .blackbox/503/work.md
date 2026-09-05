# Work — quickstart-now/hejbro#503

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the r6 ruling gains a third paragraph after the measurement

_2026-09-05T18:08Z · per R6_

R6 gained a third paragraph after the measurement: two sentences of the requirement that predate it -- the `42804`-only refusal code and the implicit-cast unification sentence -- are corrected under the same reading, and the delta edits land with it.

<a id="w2"></a>
## W2 — the family fold's compile cost measured against the pre-rule baseline

_2026-09-05T18:50Z · per R4_

Measured on `packages/core` with `tsc --noEmit --extendedDiagnostics`, three conditions: the rule with its 11x11 matrix test (252096 instantiations, check 4.18s), the rule without the matrix test (242575, 4.14s), and the pre-rule baseline (229899, 4.06s); the consumer leg `packages/query` moves 303819 -> 311367 (+2.5%) against a baseline built without the rule. The family fold itself costs about 5.5% of core's instantiations and the exhaustive matrix test about 3.9% -- +9.7% instantiations and +3.0% check time in total. The 2.54x wall-clock reading that stopped H-2 earlier was host load, not the rule: the ra and lc pieces' full gates ran concurrently on this host and that run reported 322% cpu.

Measured once more with the lead's own isolation, `select.ts` swapped back to a2219196 while the matrix test stays in place: 238046 instantiations, check 3.98s. Against that, the fold alone costs 1.059x instantiations -- the pre-rule baseline above (229899) removes the matrix test as well, so this is the number the 2x regression threshold applies to. The `packages/query` baseline reproduced to the digit across two runs (303819).

