# Decisions — quickstart-now/hejbro#553

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-31T00:00Z_

The owner instructed processing of the remaining #282 sub-issues
(2026-08-31, in session), which discharged the roadmap's Deferred gate
for the Nile preset. The preset work then measured its way into a
contract collision, and the owner ruled twice, in session, from the
lead's four-option escalation:

1. **Direction D+A**: the generic context mechanism is generalized in
   a preceding change (this one, #553) that gates #301; the Nile
   preset then expresses `asTenant(...)` on the generalized mechanism.
2. **The preset ships** despite Nile refusing RLS, functions, triggers
   and GRANT — the preset validator fails those early with explicit
   errors (recorded here because it came from the same ruling session;
   it lands in #301).

