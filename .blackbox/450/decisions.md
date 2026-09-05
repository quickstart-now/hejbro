# Decisions — quickstart-now/hejbro#450

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The no-deduplication placeholder contract stands; the distinct-on/order-by literal shape is documented for users and the issue closes

_lead · interpretation · basis 412/D24, 412/D25; the owner-settled compiler contract of 2026-08-26 (sequential placeholders, no deduplication, restated in packages/query/src/compile/params.ts); the issue's own text: documented-and-loud is a legitimate permanent answer · 2026-09-05T04:46Z · ratified: pending_

Root cause: Postgres compares DISTINCT ON and leading ORDER BY expressions as parsed trees, and `$1`/`$2` are different trees; the only compiler-side fixes are global deduplication or a targeted "an order-by term structurally equal to a distinct-on term reuses its placeholders" exception. Both make placeholder numbering depend on structural equality across clauses -- implicit behaviour the owner's explicit-over-implicit preference and the settled contract both refuse, for a shape that is narrow (a computed distinct-on term carrying a literal, repeated verbatim) and fails loudly with the server's own message. Terminal state: the constraint and its two workarounds (order by the source column; a CTE) are documented where users read (skills/hejbro/references/query-layer.md), the code comment stays, and the issue closes on this ruling. Ratification: owner on return.

