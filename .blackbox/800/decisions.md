# Decisions — quickstart-now/hejbro#800

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D99 parenthetical amended to the shipped table-bound rendering, marked as amended under delegation

_lead · extension · basis D1 · 2026-09-04T13:53Z · ratified: pending_

Under the full delegation (#412 D12) and the decision rule (#412 D13): D99's parenthetical is amended to state the shipped, specified rendering — a table-bound column reference renders `"table"."column"` (cli-commands "An expression is compared through the server's own rendering", `fix-nile-findings`, #754) — in place of "rendered fully qualified … the shared renderer has no bare-column mode", which the delta and the live output contradict. Scope: the one clause and its index row, marked "amended under delegation, ratification pending" so the owner sees it on return. The decision itself (array element honesty, the derived CHECK) is untouched; a decision-log change beyond making an entry agree with shipped behavior would still wait for the owner.

