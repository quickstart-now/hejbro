# Decisions — quickstart-now/hejbro#823

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — attribution of a failed ledger write: site named, rolled back stated, 23502 branch, tag before apply-failed, exit 2 (see 836/R1)

_lead · interpretation · basis 412/D12, 412/D13, 412/R27 · 2026-09-04T21:02Z · ratified: pending_

Same ruling as 836/R1 (one change, one rule). For this issue specifically: D3 — the write diagnostic names the write site ("recording `<file>`") and says the migration was rolled back with it, so nothing from the file is applied; the `23502` branch names the identity/default the bootstrap creates; D4 — the tag is attached where `ledger.ts` sends the insert, and `execute.ts` consults it before `apply-failed`; D5 — exit 2, not 1, because the database did not refuse the migration.

