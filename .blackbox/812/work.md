# Work — quickstart-now/hejbro#812

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Trigger change, tool re-vendor, 809 record closed

_2026-09-04T10:31Z_

- `ci.yml` `push: branches: [main]`.
- `.blackbox/bin/blackbox.mjs` re-vendored from agent-skills main `b343ec10` (#28: keyword lists link every number; a linked number that is not an issue here is skipped).
- `.blackbox/809/` recorded closed (its `Closes #807, #809` line had linked only #807 before the #28 fix).

