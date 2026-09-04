# Decisions — quickstart-now/hejbro#807

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — One commit is checked once: the release PR must not run CI twice

_owner · 2026-09-04T08:48Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#61_

"On the release PR (#803) the same CI appears twice: `ci / verify (22) (pull_request)` and `ci / verify (22) (push)`, the same for `verify (24)` and `blackbox` — two runs per event on one commit."

Read by the lead as: one commit should be checked once. The duplicate is structural for a PR whose head is `dev` — `ci.yml` fires on `push` to `dev` and on every `pull_request` — not a flake.

<a id="r1"></a>
## R1 — PR runs are limited to PRs into dev; a dev → main PR takes its checks from the push run

_lead · interpretation · basis D1 · 2026-09-04T08:48Z · ratified: pending_

`pull_request: branches: [dev]`. A PR run only for PRs into `dev` (feature PRs, the Version Packages PR). A PR into `main` is only ever `dev → main` (AGENTS.md "Git workflow"), whose head is `dev` itself: the push run on `dev` already tested that SHA, and the ruleset's required checks (`verify (22)`, `verify (24)`) match by check name on the head SHA regardless of event — #803's own checks list shows the push runs, so the release PR keeps its required checks from the single push run. The push trigger on `dev` stays because a squash commit is a new SHA no PR run tested; the push trigger on `main` stays for the merge commit. A hotfix PR straight into `main` would get no run and stay blocked, which enforces the dev → main rule rather than weakening it. Kept the job-level `if` skip alone rather than a `concurrency` group: concurrency cannot dedupe across two events.

<a id="r2"></a>
## R2 — PR-run filter withdrawn in favour of the approval gate on the release PR

_lead · interpretation · basis D1 · 2026-09-04T08:57Z · ratified: pending_

The `branches: [dev]` filter from R1 is withdrawn by 809 D3/R3: the release PR needs a `pull_request` run of its own so the owner's approval has something to gate. The duplicate on the release PR is now a run that waits without runner time and is cancelled whenever dev moves; the one real duplicate left is the approved release run, once per release.

