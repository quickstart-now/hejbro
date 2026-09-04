# Decisions — quickstart-now/hejbro#744

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — #744 is fixed on the scanner side; load is reproduced with a synthetic burner

_lead · interpretation · 2026-09-03T12:40Z · ratified: pending_

Ledger R37.

#744 is fixed in the scanner (skip `_tmp-*` and `.uo-contract`, ignore ENOENT) — the three producers of `_tmp-*` must stay inside the package because of self-reference resolution (load-emitted-contract.ts:12-18, measured). Load reproduction is a synthetic CPU burner plus a single full test run; parallel runs in the same worktree disturb shared state.

