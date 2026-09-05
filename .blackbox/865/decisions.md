# Decisions — quickstart-now/hejbro#865

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — #865 folds into add-ledger-checksum: a ledger carrying row-level security is refused from the catalog before any row is read

_lead · extension · basis 412/D24, D25; the ld reviewer's constructor finding; the identity judgement already reads the ledger's pg_class row · 2026-09-05T06:18Z · ratified: pending_

Same table, same identity probe: relrowsecurity/relforcerowsecurity on the ledger relation refuse with apply-ledger-filtered naming ledger, role and policies; reltuples is not used (an estimate). One ADDED requirement in migration-apply; task 1.6 added. Ratification: owner on return.

