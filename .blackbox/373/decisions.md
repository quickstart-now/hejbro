# Decisions — quickstart-now/hejbro#373

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

The owner supplied an external AI review of the repository's agent
tooling and asked for the lead's verified assessment; among its
confirmed findings was that `skills/hejbro` never learned the query
layer exists and that its snippets were never compiled. Asked where the
adopted items should live, the owner ruled them into the #282 gate —
"0.2.0 slipping is fine" — and set the orientation "I prefer root-cause
solutions." This piece is that finding executed at the root: not just
new prose, but a harness that makes stale prose fail.

