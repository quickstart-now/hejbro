# Work — quickstart-now/hejbro#785

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Recorder moved to .blackbox with the vendored tool, hooks, CI-first job and AGENTS.md

_2026-09-04T03:52Z_

- `blackbox/` → `.blackbox/` (78 legacy entries kept as written; the conventions README is replaced by the generated index, whose Conventions section carries the rules).
- `.blackbox/bin/blackbox.mjs` vendored from the skill; `pnpm blackbox …` and `pnpm check:blackbox` scripts.
- `.claude/settings.json`: `UserPromptSubmit`, `Stop`, `PreToolUse` (merge and team-brief gates), `PostToolUse` (task-times reminder) hooks.
- `ci.yml`: `blackbox` job first; `verify` needs it.
- `AGENTS.md`: the Provenance section describes the folder form and names the hooks and CI as the enforcement; the "before claiming done" item now reads "recorded and pinned, check passes".
- Biome: `meta.json` files are tool-owned and excluded from formatting.
- This folder (#785) is the first folder-form record in this repository; the ledger migration (D3) follows as its own issue.

