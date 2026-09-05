# Work — quickstart-now/hejbro#866

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — vendored dd-blackbox meta v3 and migrated 126 folders: meta 617KB → 139KB, pins once per PR (97 files, 200KB)

_2026-09-05T00:21Z_

Tool: `.blackbox/bin/blackbox.mjs` vendored from quickstart-now/agent-skills#30 (PR #31), byte-identical. `blackbox migrate --to 3 --dry-run` planned 126 folders at version 1 → 3 with 97 pin files to write; `migrate --to 3` did exactly that and a second run reported nothing to migrate. Measured: `meta.json` total 617KB → 139KB, the `prs` column 370KB → 11KB; 97 pin files under `.blackbox/prs/` total 200KB; `.blackbox/412/meta.json` 39.6KB → 14.5KB (what remains is its 44 decision entries). One pin carries a `history` (PR #784: two folders had pinned it with different refs; the later pin is the body). `blackbox check` ok, `pnpm check:blackbox` ok, `hook prompt` renders. AGENTS.md's record sentence updated to the v3 shape. Feature branches in flight rebase onto this and run `migrate --to 3` on their own folders.

