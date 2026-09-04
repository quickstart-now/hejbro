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

