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

<a id="d2"></a>
## D2 — The approval applies to the release PR only, not to every PR

_owner · 2026-09-04T08:55Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#71_

"You do know that applies only to the release PR, not to every PR, right?"

Correction of the lead's reading of D1: the approval-gated run is the release PR's, not every PR's. The environment gate on feature PRs (R1) was an over-application and is withdrawn.

<a id="r2"></a>
## R2 — Gate withdrawn: after #807 the release PR runs nothing of its own; concurrency dedupe kept

_lead · interpretation · basis D2 · 2026-09-04T08:55Z · ratified: pending_

R1 withdrawn. With #807 (`pull_request: branches: [dev]`) the release PR has no PR-event run at all: its required checks are satisfied by the push run on `dev` at the same SHA, and that run is the squash-commit validation every feature PR needs regardless — so there is no release-PR run left to gate, and nothing for the owner to approve before the merge itself, which is the owner's own step. The `verify` environment and the AGENTS.md line are removed; the `ci-pr` and `ci-push` environments are deleted. Kept: the per-PR `concurrency` group with `cancel-in-progress` on PR events — not an approval, only the removal of the run on a superseded head (the bot's pin commit), which the owner's "resource waste" covers. #809 closes as resolved by #807 plus this dedupe.

