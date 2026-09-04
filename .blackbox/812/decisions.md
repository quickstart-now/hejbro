# Decisions — quickstart-now/hejbro#812

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — A release PR must not see a working run per dev merge

_owner · 2026-09-04T10:31Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#103_

"On the release PR #803 as well, a push CI and a PR CI each fire."

After #808 the PR-event run waits at the approval without runner time; the run the owner still sees working is the push run on `dev`, fired by every feature merge that moves the release PR's head.

<a id="r1"></a>
## R1 — Push runs only on main; PR merge-ref runs and the approved release run cover dev

_lead · interpretation · basis D1 · 2026-09-04T10:31Z · ratified: pending_

`push: branches: [main]`. The push run on `dev` was the squash-commit validation, but a feature PR's `verify` checks out `refs/pull/N/merge` (dev + branch), so the tree the squash produces was tested by the PR run, and the approved release-PR run checks the dev tip once more right before a release. What is lost: only a race where dev moved between a PR's last run and its merge — the release run catches that before anything ships. The push run on `main` stays: it validates the merge commit that is published. The `git fetch origin dev:dev` guard keyed on `github.ref != 'refs/heads/dev'` is unaffected (main push still fetches dev; PR runs do too).

