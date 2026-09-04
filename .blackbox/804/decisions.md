# Decisions — quickstart-now/hejbro#804

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Release PRs and bot PRs are not put through the blackbox work-item gate

_owner · 2026-09-04T08:25Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#48_

"These kinds of CI runs — the blackbox job on the release PR (#803) and on the Version Packages PR (#746) — probably don't need blackbox to run at all, do they?"

Read by the lead as: a release PR and a bot PR are not work items, so the work-item gate (folder, pins) does not apply. The release conditions (ratification, merged-pending) stay on the release PR, which is the owner's own release-gate design (`.blackbox/785/`). Fixed in the canonical tool (agent-skills #26) and re-vendored here with the workflow change.

