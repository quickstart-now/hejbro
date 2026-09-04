# Decisions — quickstart-now/hejbro#778

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch ck = #778 #779 #781 as one change harden-check-expressions, parallel to li and ip

_lead · interpretation · basis D1 · 2026-09-04T14:14Z · ratified: pending_

Fourth batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the co team dissolved: the `check` expression bugs #778 (index predicates and generated-column expressions are not compared through the server's rendering as the spec claims), #779 (the not-compared finding delimits expression texts with the quote SQL identifiers use) and #781 (a matching generated column is always reported as a default difference) — three bugs, one change `harden-check-expressions`, one PR, tracking issues = the bug issues. Files: `packages/cli/src/check/*` and their tests, the check section of `skills/hejbro/` — no overlap with li (`apply/*`, `commands/migrate|status`) or ip (`commands/init.ts`, `config.ts`). Team ck = planner (fable), implementer (sonnet), reviewer (opus) in constructor mode (the input is the database catalog and the server's own rendering — foreign input, D110). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: a check must tell the truth about whether the database matches the declaration).

<a id="r2"></a>
## R2 — harden-check-expressions approved; one rule for four expression surfaces; Q1 Q3 Q5 Q7 Q8 as recommended

_lead · interpretation · basis D1, R1 · 2026-09-04T14:28Z · ratified: pending_

Proposal and delta of `harden-check-expressions` approved under the delegation (#412 D12/D13 on dev): `validate --strict` valid; cli-commands MODIFIED 2, no scenario dropped or renamed, eleven scenarios added; no diagnostics delta. The four expression surfaces — check constraint, index predicate, index expression column, generated column — are compared by one rule (the server's rendering; the same text fallback; the same not-compared report), which is what "does check tell the truth about my database" requires; a surface compared for existence only while the spec promised a rendering comparison was a false "present".

Q1 probe form (a): one `explain (format json, costs off, verbose) select …` per object carrying every (declared, catalog) pair, compared pairwise by position — same session, fewest round trips, measured to six items.
Q3 index catalog read (a): the bulk `indexes` query gains `predicate` (`pg_get_expr(indpred)`) and `expressions` (the `indkey = 0` positions through `pg_get_indexdef(oid, n, true)`, aggregated in order); existence comparison keeps using the widened row.
Q5 text mode (a): the six normalization steps apply unchanged to all four surfaces, each expression column normalized on its own; the boundary sentence says "expressions" and lists the surfaces. No step is added here — a wider step is #782's own decision, taken in its own item.
Q7 expression-column count mismatch (a): reported as `check-object-differs` ("declaration has 1 expression column, the database's index has 0") with no probe — the declaration and the database differ, so differs is the truth; plain columns, uniqueness and method stay existence-only and the spec and skill say so.
Q8 identities and labels as proposed: `schema.table.index` with "index predicate" / "index expression column n"; `schema.table.column` with "generated column"; no new codes.

<a id="r3"></a>
## R3 — Review: an index compares its whole ordered key list by position, both directions; generated-vs-plain may quote the database default

_lead · interpretation · basis D1, R2 · 2026-09-04T16:12Z · ratified: pending_

Constructor review round 1 (two passes) found three blockers with one root: `hasExpressionSurface` in `commands/check.ts` hands an index to the expression comparison only when the *declaration* carries a predicate or an expression column, so (B1) declared plain column vs database `lower(a)` and (B2) declared total vs database partial are "no differences" exit 0, and (B3) a declared expression Postgres stores as a plain key column — a bare column reference, `(col)`, `col COLLATE "C"` — is reported as drift against a database `hejbro generate` itself produced, with a `Next:` no migration can satisfy. Ruling: the unit of comparison for an index is its ordered key list, not its "expression columns" — every key position on both sides, plain column or expression, is paired by position and rendered through the same server probe (a plain column renders to itself), and the predicate is compared present-vs-absent before its text; the filter goes, and a count mismatch on either side is `check-object-differs`. Under `explainUnavailable` the same list is compared by the six normalization steps per position. Basis: D13 on dev — `check` reports drift only when the database differs from the declaration, in either direction, and never against hejbro's own output. Also: the generated-vs-plain diagnostic may quote the database's default (Q4, 781/R1) — the scenario's "reports nothing about its default" is amended to "reports no default difference"; the information is not a finding. Non-blocking: backtick collision #841, driver session SETs #842, the exit-code folding of not-compared into 1 is pre-existing and filed.

