# Decisions — quickstart-now/hejbro#336

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-27T00:00Z_

1. The owner asked whether the residual defect group of the #282 gate
   should be processed in the order #341 → #342 → #336/#337/#339.
2. The assistant answered that the only hard dependency in that set is
   #341 before #342 (stated in #341's own body; both harden groups have
   landed, so both are unblocked), that #336/#337/#339 are mutually
   independent and file-disjoint from the rest, and recommended pulling
   #336 to the front: a minutes-scale script fix whose effect — gate
   fidelity — benefits every subsequent piece's review runs, where the
   `TURBO_FORCE=1` form is only an effect-level workaround.
3. The owner approved: proceed as proposed.

