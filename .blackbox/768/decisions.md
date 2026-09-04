# Decisions — quickstart-now/hejbro#768

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D4: the blocking ancestor is named on EACCES/EPERM, the failing node otherwise

_lead · interpretation · basis D1 · 2026-09-04T13:07Z · ratified: pending_

D4 (#768) — option (i), by error code: on `EACCES`/`EPERM` anywhere in the chain the `Next:` names the deepest ancestor that stat could still reach (stat's EACCES is always a directory above the leaf, never the leaf); on any other code (`ELOOP` and the like) the failing node itself, because a self-referencing `loop` under `loop/mig` makes the parent innocent and one rule cannot cover both. `walkAncestors` climbs through EACCES and returns the blocking node; `throwStatFailed(label, field, code, culprit)` is the shape #767 reuses. The permission rows skip when the suite runs as root.

