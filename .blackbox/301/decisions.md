# Decisions — quickstart-now/hejbro#301

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-31T00:00Z_

1. **Direction D+A** (2026-08-31): generalize context application first
   (#553), then express `asTenant(...)` on the generalized mechanism.
   This change is the "A" half.
2. **The preset ships** despite Nile refusing RLS, policies, functions,
   triggers and `GRANT`: the preset's validators fail those early with
   explicit errors — detect, options, commands — never a silent rewrite.
   `GRANT` (and later the serial-family and primary-key rules) are
   measured refusals, not documented ones, and the errors say so.

Everything else in this change was settled under the owner's standing
delegation by the lead session and is listed for the owner's return.

