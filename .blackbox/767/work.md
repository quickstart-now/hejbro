# Work — quickstart-now/hejbro#767

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — create-time and read-time EACCES coded; nothing left behind

_2026-09-04T15:34Z_

Create-time and read-time EACCES coded; nothing left behind.

Commits: 3eebe5f3, e197a74b, 7d95139c, 4aef214a, f92829fa (see #741's own
work entry for the full breakdown per finding).

#767's own class (raw filesystem errors reaching the user instead of a
coded diagnostic) is closed on both the write side and the read side of
`hejbro init`'s three artifacts and every command that reads the
snapshot:

- **Write side, check (B1 check side).** `accessSync(dir, W_OK)` on the
  deepest existing ancestor for every absent artifact, before anything
  is created -- a parent whose mode denies writing refuses coded, names
  the directory, and creates nothing.
- **Write side, create (B1 create side).** Even a passing `access`
  check can be wrong. The apply pass now tracks, per artifact, the
  first node its own creation would add (computed before creating,
  since a failed recursive `mkdir` reports nothing about which
  segments it made) and rolls every tracked node back, deepest-first,
  on any creation failure -- a partial tree never survives a refused
  run. The culprit named in the message is `dirname(error.path)` for
  `EACCES`/`EPERM` (the directory that refused the write); any other
  code (`ENOSPC`, `EDQUOT`, ...) names `error.path` itself, since there
  is no ancestor to blame the way a permission failure has one.
- **Symlinks (B3).** A dangling symbolic link at an artifact's own path,
  or on its ancestor chain, is judged by what it points at rather than
  read as "nothing there" -- refused, naming the link and its target,
  never written through.
- **Read side (B2).** Every command that reads the snapshot file
  (`generate`, `verify`, `check`, `baseline`, sharing one reader) now
  refuses a file it cannot read, or a directory on the way that blocks
  the look-up, with the new code `snapshot-unreadable` -- naming the
  configured path and the operating system's own code, `Next:` naming
  the blocking directory by the same rule `init` uses (shared via the
  `path-probe.ts` extraction, a pure move pinned by the untouched
  `init.test.ts` suite).

Every permission-dependent test skips under `process.getuid?.() === 0`
(root bypasses every check exercised here) and restores modes -- and,
for the rollback tests, the process umask -- in an `afterEach` that
runs before the file-level fixture cleanup (vitest unwinds `afterEach`
hooks inside-out; verified empirically, not assumed).

Full gate sweep green throughout (91 files / 1009 tests at the group's
close; `check`, `check-types`, `check:bans` all clean).

