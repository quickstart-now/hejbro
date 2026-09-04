# Decisions — quickstart-now/hejbro#779

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q6: expression texts delimited by backticks at all four sites, codes and Next unchanged

_lead · interpretation · basis D1 · 2026-09-04T14:28Z · ratified: pending_

Q6 delimiter (a): the expression texts in the not-compared and differs findings are wrapped in backticks — the same convention the diagnostics already use for commands, and a character SQL never uses for quoting — at all four sites (two not-compared, the text-mode not-compared, and `differs`' "renders as …"), with the codes and `Next:` lines unchanged (diagnostics: prose may move, the code may not). Labelled lines (b) would need `diagnostics.ts` to indent multi-line messages — a file outside this piece, for the same effect.

