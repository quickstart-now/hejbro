# Design: harden-init-paths

Lead rulings under the owner's delegation (#750 D3/D7) settle the contract
details below — `.blackbox/741/` R2 (approval, D1), `.blackbox/743/` R1
(D2), `.blackbox/766/` R1 (D3, D3b), `.blackbox/768/` R1 (D4). The delta
spec carries the contract; this file carries the shape the implementation
takes. Measured facts come from reading `packages/cli/src` at `eb340e73`.

## D1 — `--config` names the file; the artifacts stay rooted at the working directory (#741)

- **Fact.** Only `generate`/`baseline` and `history` read `--config`;
  `check`, `verify`, `reset`, `restore` pass `undefined` (filed #819).
  Where it is honoured, `migrationsDir`/`snapshotPath` resolve as
  `join(cwd, value)` — the working directory — while `entry` globs resolve
  from `dirname(configPath)` (`loader.ts:257`). Making every command
  config-relative is #819, after the li batch merges.
- **Shape.** `initCommand` gains `args.config` (same description text as
  `history`), runs `normalizeEqualsFlags` then `lastFlagValue(rawArgs,
  "--config")`, and calls `runInit(cwd, rawArgs)` — `rawArgs` defaults to
  `[]` so every existing call stands. `loader.ts` exports
  `resolveConfigPath` (absolute as given, else `resolve(cwd, flag)`, else
  `join(cwd, "hejbro.config.ts")`) — one resolver, never a second; `init`
  uses it for the config artifact's path and passes the flag to
  `loadConfig`. The config artifact's label is `fileLabel(cwd, configPath)`
  (`sub/hejbro.config.ts`, `../other/hejbro.config.ts`; the default case
  still renders `hejbro.config.ts`). When nothing sits at the named path the
  template is written there, its parent created by the existing file-artifact
  `mkdirSync` (the ancestor check already covers a file in the way).

## D2 — An absolute-looking artifact path is refused at parse (#743)

- **Fact.** `path.join(cwd, "/db/migrations")` swallows the leading `/`;
  every command writes under the working directory and only the display
  differs — `init` relative, `generate` `join(migrationsDir, fileName)`
  (`generate.ts:582`), `verify` and `snapshot-file.ts` the raw spelling.
  `verify`'s `Next:` lines embed that spelling in shell commands
  (`verify.ts:74-92,150,179`), which a shell resolves at the filesystem
  root. The previous change pinned `join` as the contract in a *test* row
  (`init.test.ts:143-148,191-196`), not in a spec scenario; those rows
  become refusals.
- **Shape.** `parseConfig` refuses a `migrationsDir` or `snapshotPath` that
  `isAbsolute` accepts, after the zod parse and beside
  `findInvalidPresetIndex`, with `invalid-config` in `describeIssue`'s own
  style — field named, `Next:` naming the relative spelling, **no
  configuration path in the new message** (#745 owns that text). Relative
  spellings (`./x`, `x/`, `../x`, `""`) pass the parser unchanged; the
  variance in how commands print a relative spelling stays.

## D3 — Nested planned paths refuse under `init-path-conflict` (#766)

- **Fact.** `checkNoDuplicatePaths` compares for equality only. A planned
  **file** that is a strict ancestor of another planned path passes, `init`
  creates the directory, and `applyArtifact`'s `existsSync` reports the
  snapshot as present. A snapshot *inside* the migrations directory works
  (`listMigrationFiles` reads `.sql` only; measured in D106 R2) and stays
  legitimate.
- **Shape.** `checkNoNestedPaths` beside `checkNoDuplicatePaths`, over the
  same `artifactPairs`, after the duplicate check and before the ancestor
  walk: refuse when `a.kind === "file"` and `relative(strip(a.path),
  strip(b.path))` is non-empty, not absolute and does not start with `..`
  (`strip` = `stripTrailingSeparators`). Message, worded from the fields
  so the configuration artifact (also a file) reads correctly if it ever
  pairs: `"mig" is named by snapshotPath, and migrationsDir ("mig/sub")
  would have to be created inside it — a file cannot hold a directory.
  Next: point snapshotPath at a file outside migrationsDir, then rerun
  \`hejbro init\`.` Both labels via `fileLabel`. Order: after the
  duplicate check, before the ancestor/kind walk — a configuration fault
  answers before the node that happens to sit where it points.

### D3b — `generate` refuses a directory at the snapshot path (#766, second ask)

- **Fact.** `readSnapshotFileText` (`snapshot-file.ts:42-44`; shared by
  `generate`, `verify`, `check`) tests `existsSync` then `readFileSync` —
  a directory passes the test and dies with a raw `EISDIR`. The mirror (a
  file at `migrationsDir` → raw `ENOTDIR` in `listMigrationFiles`) is
  #820, in the #767 batch.
- **Shape.** `readSnapshotFileText` stats the path before reading; a
  directory → `snapshot-not-a-file`: `"db/state.json" is named by
  snapshotPath, but a directory is there — the snapshot is a file hejbro
  writes. Next: move or remove that directory, then rerun \`hejbro
  init\` to scaffold an empty snapshot (or restore the file from version
  control if migrations already exist).` Path printed as configured (this
  file's existing convention). A stat failure other than `ENOENT`/`EISDIR`
  keeps today's behaviour (#767's class).

## D4 — A permission failure names the deepest reachable ancestor (#768)

- **Fact.** `stat` fails with `EACCES` when a directory on the way denies
  search; never because of the leaf (a mode-000 leaf still stats). Today
  the leaf (`init.ts:330`) or the failing segment (`init.ts:246`) is named —
  for `nx` mode 000 under `nx/a/mig` that is `nx/a`, not `nx`. `ELOOP`
  forbids a single rule: a self-referencing `loop` under `loop/mig` fails
  at `loop` itself and its parent is innocent.
- **Shape.** `walkAncestors` continues upward past `EACCES`/`EPERM` as it
  does past `ENOENT`/`ENOTDIR`, remembering that a permission failure
  occurred, and returns the ancestor it finally stat'd as the blocking node
  (`{ kind: "blocked", culprit, code }`); `checkPathKind`'s stat-failed
  branch asks the same walk for the culprit when its own code is
  `EACCES`/`EPERM`. `throwStatFailed(label, fieldName, code, culprit)`:
  `"nx/a/mig/" could not be checked for migrationsDir (EACCES): "nx" does
  not let this process look inside it. Next: check permissions on "nx",
  then rerun \`hejbro init\`.` Any other code keeps naming the node whose
  stat failed, `culprit` = that node. The one comment states the constraint:
  `stat`'s `EACCES` is always a directory on the way, never the leaf. Tests
  skip under `process.getuid?.() === 0`.

## D5 — No diagnostics delta

`init-path-conflict`, `invalid-config`, `config-load-failed` are reused;
`snapshot-not-a-file` is new but governed by the diagnostics capability's
existing requirement (a code plus a `Next:`); its contract lands in
`cli-commands`.

## Foreign input

The inputs are configuration files, argv and a filesystem — outside
hejbro's own output. The piece's reviewer runs in constructor mode
(D110): delta scenarios and the public surface only, concrete projects
built under `/private/tmp/review-ip-*`, driven through the built
`packages/cli/dist/cli.js`.
