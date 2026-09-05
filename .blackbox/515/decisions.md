# Decisions — quickstart-now/hejbro#515

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Core exports its expression traversal registry and kind-change guards as extension surface; the four copies fold

_lead · extension · basis 412/D24, 412/D25; .claude/rules/provider-preset.md (a preset needing a core special case means the interface is wrong); the SELECT_CLAUSE_TRAVERSALS precedent; #444's four hand-written traversal sites · 2026-09-05T05:44Z · ratified: pending_

Design (design.md Q1-Q3): five names exported from @hejbro/core as engine surface (never the hejbro barrel), the query lifter and the supabase validator walk through exprChildren/replaceExprChildren, the two kinds use requireNext/requirePrevious/requireBoth; codec's NODE_KIND_TO_SNAPSHOT and reachable-kinds stay separate ledgers (naming.md). package-surface: one ADDED requirement. Ratification: owner on return.

