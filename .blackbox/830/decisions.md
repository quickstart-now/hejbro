# Decisions — quickstart-now/hejbro#830

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — OD4: --config decided by probePath (config-not-found / config-not-a-file / config-unreadable); OD5: empty or trailing --config refused with invalid-config-flag

_lead · extension · basis D1 · 2026-09-04T20:16Z · ratified: pending_

OD4 — option (a): the loader decides the `--config` path through the shared `probePath`: absent → `config-not-found` naming the path actually looked up and `hejbro init --config <same value>` (the flag-less golden wording stays byte-identical); a directory or dangling link → new `config-not-a-file`; cannot be checked → new `config-unreadable`; `init` states the same sentence under `init-path-conflict` as last round's convention (not a1). #819 reuses this judgement for every command.
OD5 (NB8) — option (a): an empty or whitespace-only `--config` value, and a trailing `--config` with no value, are refused with new `invalid-config-flag` (the `invalid-rename-flag` precedent): a flag that names nothing is not the default. If the argument parser answers first, that is a tripwire to the lead.

