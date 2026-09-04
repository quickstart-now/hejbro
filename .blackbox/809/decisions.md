# Decisions — quickstart-now/hejbro#809

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — The heavy PR checks run only once the owner approves them (environment review)

_owner · 2026-09-04T08:52Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#66_

"And this too: rather than running every time, it looks better to run only once approved — if CI keeps running while a PR is open, that is CI/CD resource waste."

Asked which signal "approved" is (draft → ready, a `ci` label, an environment with the owner as required reviewer, or only skipping the pin re-run), the owner chose the **environment approval**: the heavy checks on a PR run when the owner approves the deployment review.

<a id="r1"></a>
## R1 — Environment gate on verify, cheap blackbox job free, one approval per PR through concurrency cancellation

_lead · interpretation · basis D1 · 2026-09-04T08:52Z · ratified: pending_

- `verify` runs under environment `ci-pr` (required reviewer: the owner, self-review allowed) on a human `pull_request`; under `ci-push` (no rules) on `push` to `dev`/`main` — the squash or merge commit the owner already approved through the PR — and on bot PRs, which the Actions first-contributor policy already holds. Both environments created through the API (`ci-pr` reviewers = hello-pooh; `ci-push` empty).
- `blackbox` stays ungated: it is cheap (about 13 s) and must run on every push to land the pins before anyone approves.
- `concurrency` group per PR with `cancel-in-progress` on `pull_request` only: the bot's pin commit follows the PR open within seconds, so the first run is cancelled while still waiting and the owner approves once, on the final head. Push runs are never cancelled — each SHA on `dev`/`main` is a merge.
- A PR into `main` has no PR run at all after #807, so the release path is unchanged: push run on `dev`, owner merge, push run on `main`.
- Recorded in AGENTS.md "Git workflow" so the approval is part of the flow, not a surprise on the first PR.

