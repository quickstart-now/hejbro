# Work — quickstart-now/hejbro#741

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — init honours --config; artifacts stay cwd-rooted

_2026-09-04T14:11Z_

init honours `--config`; artifacts stay cwd-rooted.

Commits: 357c2b12 (openspec change artifacts), 477d55fb (implementation).

`runInit(cwd, rawArgs: ReadonlyArray<string> = [])` gains a `--config`
flag, resolved via `loader.ts`'s own `resolveConfigPath` (now exported —
the one resolver every command shares, never a second one). The
configuration artifact's report label is `fileLabel(cwd, configPath)`.
`migrationsDir`/`snapshotPath` stay resolved from the working directory
regardless of where `--config` points, so `init --config X` and
`generate --config X` act on the same files by construction.

Measured: an 11-row input table (D110) — `--config` omitted, explicit
default, a subdirectory path present/absent, an escaping `../other` path
present/absent, an absolute path, a directory sitting where the config
belongs, an unresolvable import, the `--config=path` equals form, and a
subprocess round-trip pin (`init` then `generate --config` reading what
`init` wrote). The round-trip fixture had to place its declaration file
under `sub/` rather than at the fixture root, because `entry` resolves
glob patterns from the configuration file's own directory
(`dirname(configPath)`), not the working directory — an existing,
unrelated asymmetry (filed as #819, next batch, not touched here).

Full gate sweep green at commit time (91 files / 948 tests, `check`,
`check-types`, `check:bans`).

<a id="w2"></a>
## W2 — review round 1: three constructed-input findings fixed

_2026-09-04T15:34Z_

Review round 1: three constructed-input findings fixed.

Commits: 51b14a29 (group-2 openspec artifacts), efa88e4e (lead detail
rulings folded in), 3eebe5f3 (D8 dangling symlink), e197a74b (D6 check
side), 7d95139c (D6 create side), 4aef214a (refactor: ancestor walk
moved to path-probe.ts), f92829fa (D7 snapshot-unreadable).

The reviewer's constructor-mode round 1 found three blocking items
against this piece's own artifacts (folded into this change rather than
filed as separate follow-ups, ruling 741/R3):

- **D8 (dangling symbolic link).** `statSync` follows a link; a
  dangling one stats `ENOENT` and reads as absent, so `init` wrote
  straight through it to a target the report never named.
  `commands/init.ts`'s `statOutcomeAt` now `lstat`s first; a dangling
  link at an artifact's own leaf or on its ancestor chain refuses,
  naming the link and the target it points at. The `ELOOP` wording
  changed too (non-blocking finding 3): a loop's own `Next:` now says
  "check what ... points at", not "check permissions on" -- a loop was
  never a permission problem.
- **D6 (creation checked and undone).** The check stage stat'd; the
  create stage had no diagnostic of its own -- a parent with mode 555
  passed every stat and a `writeFileSync`/`mkdirSync` threw raw, some-
  times after another artifact was already created. `checkWritable`
  now tests write access on the deepest existing ancestor for every
  absent artifact, inside the pre-creation pass. `access` can still be
  wrong (ACLs, immutable flags, a disk that fills, a race) -- the apply
  pass now records each artifact's first node before creating it and,
  on any throw, rolls back every recorded node deepest-first before
  re-throwing the same coded failure. `process.umask(0o277)` gave a
  deterministic red for the rollback (an owner-unwritable directory
  `mkdirSync` itself just created).
- **D7 (unreadable snapshot).** `readSnapshotFileText` rethrew any
  non-`ENOENT` stat/read failure raw. `walkAncestors` and its culprit
  rule moved to a new `packages/cli/src/path-probe.ts` (a pure move,
  commit 4aef214a -- the whole existing `init.test.ts` suite is the pin,
  unchanged before and after) so `snapshot-file.ts` can ask the same
  question `init.ts` does: which directory blocks the look-up. Every
  read-side command (`generate`, `verify`, `check`, `baseline`) now
  refuses a mode-000 file or a blocked ancestor with the new code
  `snapshot-unreadable`, naming the configured path and the blocking
  directory (never an absolute path).

Full gate sweep green at every commit (91 files, growing to 1009
tests). One `biome format` fixup on three of the seven commits before
`check` passed clean; one import-order fix in the new `path-probe.ts`.

