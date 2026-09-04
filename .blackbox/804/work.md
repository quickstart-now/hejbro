# Work — quickstart-now/hejbro#804

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Re-vendored tool and workflow skip for bot PRs

_2026-09-04T08:25Z_

- `.blackbox/bin/blackbox.mjs` re-vendored from agent-skills `fix-blackbox-release-gate` (PR #27, Closes agent-skills#26): `check --pr`/`ci --pr` on a release PR run the release conditions only; `ci` opens, pins and lands nothing there.
- `.github/workflows/ci.yml`: the `blackbox` job is skipped on bot PRs (`github.event.pull_request.user.type != 'Bot'`); `verify` carries `if: !cancelled() && needs.blackbox.result != 'failure'` so it runs past the skip and still stops on a failure.
- Effect on the two PRs that triggered this: #803 (release) gets a release-only check on its next run; #746 (Version Packages) gets `verify` without a blackbox run.

