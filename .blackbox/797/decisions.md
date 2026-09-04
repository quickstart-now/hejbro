# Decisions — quickstart-now/hejbro#797

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D3: cycles of any length are detected structurally; the DETAIL text is not parsed

_lead · interpretation · basis D1 · 2026-09-04T12:33Z · ratified: pending_

D3 (#797) — option (a): structural detection of a cycle of any length among the declared tables (peel nodes with no remaining in-edges; whatever is left is in a cycle; a self-reference is not a cycle and drops fine, as measured), and the advice wording moves from "a pair" to "a set of your declared tables that reference each other in a cycle". The server's DETAIL keeps precedence and the outside-dependent possibility stays alongside, as the current requirement already says. Parsing the DETAIL text for declared names (option b) is rejected: it binds hejbro's advice to a server message format, and the structural answer is already computable from the declarations alone.

