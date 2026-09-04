# Decisions — quickstart-now/hejbro#697

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The emitter writes only the __proto__ key in computed-key form

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R8.

#697 (round 2, N2): the vendored-contract emitter emits only a `__proto__` column key in computed-key form, which guarantees an own property; every other key stays literal.

<a id="r2"></a>
## R2 — The vendored fn guard rejects unknown keys, not just a wrong count

_lead · extension · 2026-09-03T00:00Z · ratified: pending_

Ledger R9.

#697 (round 2, N1): the vendored function guard rejects unknown argument keys as well as a wrong count (count plus key set). A typo in a key would otherwise be sent silently as null, a silent defect. The spec sentence is MODIFIED.

<a id="r3"></a>
## R3 — The fn guard is fixed in packages/query/src/db/fn.ts, owned by cl alone

_lead · interpretation · 2026-09-03T07:40Z · ratified: pending_

Ledger R14.

#697: the fix lives in `packages/query/src/db/fn.ts` (the vendored client shares that path); cl owns that file and `packages/query/test/client/functions.test.ts`, qc must not edit them. If `typed-function-execution` has a count sentence, it is MODIFIED alongside.

<a id="r4"></a>
## R4 — Rejection code function-argument-unknown, first unknown key named, count check first

_lead · interpretation · 2026-09-03T07:40Z · ratified: pending_

Ledger R16.

The fn guard's rejection code is `function-argument-unknown` (sibling of the count code); only the first unknown key is named; the count check runs first and its wording is unchanged.

<a id="r2-ratification"></a>
## R2 accepted

_evaluator · 2026-09-04T07:21Z_

Rules are silent on the guard's shape; rejecting unknown argument keys as well as a wrong count closes a silent-null path where a typo would otherwise be sent as data, which is the no-silent-defect standard the owner applies elsewhere.

