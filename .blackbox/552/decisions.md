# Decisions — quickstart-now/hejbro#552

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Whole-table projection under a join is qualified

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R12.

#552: a whole-table projection under a join renders qualified columns (a plain fix with a golden update).

<a id="r2"></a>
## R2 — qc's edit scope: render-sql.ts and the supabase pooler test

_lead · interpretation · 2026-09-03T07:55Z · ratified: pending_

Ledger R20.

qc may edit `packages/core/src/expr/render-sql.ts` (with its render tests) and `packages/supabase/test/pooler.test.ts` (tests only). #531 needs no code change: the pg test already observes the corrected scenario.

<a id="r3"></a>
## R3 — Qualification renders as from does; #551's left-join tracking value is UntrackedJoins

_lead · interpretation · 2026-09-03T07:55Z · ratified: pending_

Ledger R22.

#552 qualifies exactly as `from` renders (`"s"."t"."c"`, CTE `"cte"."c"`). #551's left-join tracking value is `UntrackedJoins`.

