# Work — quickstart-now/hejbro#768

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — permission-blocked check names the blocking ancestor

_2026-09-04T14:11Z_

Permission-blocked check names the blocking ancestor.

Commit: b7b13dfa.

`stat`'s `EACCES`/`EPERM` is always a directory on the way that denies
search, never the leaf itself (a mode-000 leaf still stats fine). The
refusal used to name whatever segment the walk was inspecting when the
error surfaced — the leaf itself when the artifact's *own* stat failed,
or the wrong ancestor segment when the walk stopped at the first
`EACCES` it hit, one level too shallow.

`walkAncestors` (`init.ts`) now continues upward past `EACCES`/`EPERM`
exactly as it already did past `ENOENT`/`ENOTDIR`, carrying the
permission code seen; when it finally reaches a node it *can* stat as a
directory (or the filesystem root), that node is returned as the
blocking one (`{ kind: "blocked", culprit, code }`), not "ok". A new
helper, `culpritFor`, seeds this same walk with a leaf's own already-
observed `EACCES`/`EPERM` code so `checkPathKind`'s stat-failed branch
can ask the identical question for a leaf that failed directly (rather
than during the ancestor walk). `throwStatFailed` gained a `culprit`
parameter: identical to `label` for every non-permission failure (kept
today's one-sentence wording, pinned by an `ELOOP` control case — a
self-referencing symlink fails at itself, its parent is innocent), and
a second sentence naming the real culprit when it differs.

Tests skip under `process.getuid?.() === 0` (root bypasses all
permission checks). `chmod` restoration to 0o755 is registered in the
describe block's own `afterEach`, not the file-level one, so it runs
first — observed empirically (vitest unwinds `afterEach` hooks inside-
out) rather than assumed, since a still-mode-000 directory would
otherwise make the file-level `rm(cwd, ...)` itself fail.

Full gate sweep green at commit time (91 files / 980 tests, clean
`check`/`check-types`/`check:bans` on the first pass this time).

