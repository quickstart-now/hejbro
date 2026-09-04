# Decisions — quickstart-now/hejbro#533

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Folder stays open after its PR merged: the flake it tracks is still being sampled

_lead · interpretation · basis D2 · 2026-09-04T07:21Z · ratified: pending_

#533's PR merged, but the issue stays open on purpose: the cli-smoke e2e flake it tracks recurred on #790 (both CI legs, rerun passed) and is still being sampled. The folder is closed with status `open` so the release gate reads it as intentional rather than as a merged-pending record (release gate narrowed in agent-skills #25).

