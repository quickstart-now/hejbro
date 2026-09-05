# Work — quickstart-now/hejbro#652

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — check-pr-changeset controls

_2026-09-05T05:14Z_

2026-09-05, worktree chore-pr-changeset against upstream/dev: no src change + 0 changesets -> ok; a probe line in packages/core/src/index.ts + 0 changesets -> exit 1 naming the file and the `pnpm changeset` remedy; the same + one changeset -> ok; two changesets and no src -> exit 1. Base ref is `dev...HEAD` (merge-base), so dev's own movement is never blamed on the branch. CI condition: pull_request only, head not dev and not changeset-release/*, one matrix leg. Process note: this work was rebuilt three times because a probe commit refused by commitlint (bare message / 74-char header) let a following `git reset --hard HEAD~1` discard the uncommitted work -- controls now run only after the real commit is verified, under set -e.

