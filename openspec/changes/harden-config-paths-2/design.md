# Design: harden-config-paths-2

The delta spec carries the contract; this file carries the shape the
implementation takes and the lead's rulings on the `[design]` details
(recorded under the owner's delegation in `.blackbox/846/`, `820/`,
`830/`, `831/`). Measured facts come from reading `packages/cli/src` at
`a059ce12`.

## D1 — A `snapshotPath` spelled as a directory is refused at parse

- **Fact.** `parseConfig` already refuses an absolute-looking value
  beside `findInvalidPresetIndex`. `init` refuses a trailing separator on
  a file field (`throwSpelledAsDirectory`, `init-path-conflict`) while
  `readSnapshotFileText` strips it for the stat and reads the spelled
  path, which `open(2)` refuses with `ENOTDIR` for a file — reported as
  `snapshot-unreadable` with a permissions `Next:`. `""`, `"."`, `"./"`,
  `".."` all resolve to a directory the same way.
- **Shape.** `parseConfig` gains a second post-parse check, in
  `describeAbsolutePathField`'s style: `snapshotPath` whose value is
  empty, ends with `/`, or whose last segment is `.` or `..` →
  `invalid-config`: `config field "snapshotPath" names a directory
  ("state.json/"), but the snapshot is a file. Next: point snapshotPath
  at a file path (e.g. "state.json") — drop the trailing "/" or name a
  file inside the directory.` The empty value is never echoed as a bare
  `""` (the existing refusal-label rule): `config field "snapshotPath"
  is empty, but the snapshot is a file. Next: point snapshotPath at a
  file path (e.g. "hejbro.snapshot.json"), or remove the field.` A `.`/
  `..` last segment echoes the value and suggests the default file name
  the same way. No configuration path in the message
  (#745). `migrationsDir` untouched. `throwSpelledAsDirectory` and the
  `endsWith("/")` branch in `checkPathKind` are removed (unreachable:
  every configured value passes `parseConfig`, and the default is fixed).
  `readSnapshotFileText` reads the stripped path it stat'd regardless.

## D2 — One judgement, two vocabularies (shared probe)

- **Fact.** `init.ts` holds `statOutcomeAt` (lstat-first leaf probe) and
  runs `checkAncestors` then `checkPathKind` per artifact — except the
  configuration artifact, whose `checkPathKind` runs alone at line 846
  before the loader. `snapshot-file.ts` uses a `statSync`-only probe:
  a dangling link is `ENOENT` → absent; a file ancestor is `ENOTDIR` →
  `stat-failed` with the configured path as its own culprit.
- **Shape.** `statOutcomeAt` moves to `path-probe.ts` (pure move).
  `path-probe.ts` gains `probePath(cwd, leafPath): PathOutcome` =
  `walkAncestors(cwd, dirname(leaf))` first, then the leaf:
  `{ kind: "absent", parent }` (`parent` = the deepest existing
  directory, for the write check) | `{ kind: "present", actualKind }` |
  `{ kind: "dangling", target }` | `{ kind: "ancestor-file", path }` |
  `{ kind: "ancestor-dangling", path, target }` | `{ kind: "blocked",
  culprit, code }` | `{ kind: "stat-failed", path, code }`. The leaf's
  own `EACCES`/`EPERM` asks `permissionCulpritFor` as today. `init`
  replaces `checkAncestors` + `checkPathKind` with one `checkArtifactPath`
  over `probePath`, applied to every planned artifact including the
  configuration one (before the loader — the ordering fix for the
  `--config f/h.ts` case falls out). Every `init` message keeps its own
  text; `snapshot-file.ts` and `loader.ts` map the same outcomes to
  their own codes. `checkWritable`/`firstNodeToCreate` read `parent`
  from the outcome instead of re-walking.

## D3 — Read-side snapshot outcomes

- `present`/file → read `strippedFsPath`; a read failure →
  `snapshot-unreadable` (today's sentence).
- `present`/directory → `snapshot-not-a-file` (today's sentence).
- `dangling` → `snapshot-not-a-file`: `"state.json" is named by
  snapshotPath, but a dangling symbolic link is there, pointing at
  "nowhere" — the snapshot is a file hejbro writes. Next: remove the
  link or create its target, then rerun.`
- `ancestor-file` → `snapshot-unreadable`: `"f/state.json" is named by
  snapshotPath, but "f" is a file and cannot hold it. Next: move or
  remove the file at "f", then rerun.`
- `ancestor-dangling` → `snapshot-unreadable`: `"lnk/state.json" is
  named by snapshotPath, but "lnk" is a dangling symbolic link, pointing
  at "nowhere". Next: remove the link or create its target, then rerun.`
- `blocked` → `snapshot-unreadable` (today's sentence naming the
  culprit).
- `stat-failed` (`ELOOP` and the rest) → `snapshot-unreadable`:
  `"loop" is named by snapshotPath, but it could not be checked
  (ELOOP). Next: check what "loop" points at, then rerun.` — today's
  text wrongly says the configured path "does not let this process look
  inside it".
- `absent` → the existing `snapshot-not-found`/`snapshot-lost` branches.

## D4 — The migrations-directory listing (#820)

- **Fact.** `listMigrationFiles(migrationsDirPath)` is shared by
  `generate` (baseline guard and `previousCount`, both before any
  write), `verify`, `history`, `migrate`, `status`, `restore` and the
  snapshot reader's absent branch; `check` never lists. `existsSync`
  then `readdirSync`; a file there throws raw `ENOTDIR`.
- **Shape.** Signature becomes `listMigrationFiles(cwd, migrationsDir)`
  (the configured spelling is what the message names; every caller
  already holds both). Over `probePath(cwd, join(cwd, migrationsDir))`:
  `absent` → `[]` (unchanged contract); `present`/directory → readdir,
  a readdir failure → `migrations-dir-unreadable`: `"mig" is named by
  migrationsDir, but this process cannot list it (EACCES). Next: check
  permissions on "mig", then rerun.`; `present`/file →
  `migrations-dir-not-a-directory`: `"mig" is named by migrationsDir,
  but a file is there — the migrations directory holds the migration
  files hejbro writes. Next: move or remove that file, then rerun
  \`hejbro init\` to create the directory.`; `dangling` → the same code
  with the snapshot's dangling sentence adapted; `ancestor-file`,
  `ancestor-dangling`, `blocked`, `stat-failed` →
  `migrations-dir-unreadable` with D3's sentences adapted to the field.
  Call sites: one line each (`listMigrationFiles(cwd,
  config.migrationsDir)`).

## D5 — `--config` and the configuration path (#830, NB8, #831)

- **Fact.** `resolveConfigPath` is the one resolver (`init`, `generate`,
  `baseline`, `history`); `""` resolves to `cwd`. `loadConfig` tests
  `existsSync` then imports; the not-found text is owner-approved golden
  (`golden.test.ts:176`, `loader.test.ts:42`, `verify.test.ts:312`) and
  stays byte-identical for the flagless case.
- **Shape, flag.** `resolveConfigPath` refuses `configFlag.trim() === ""`
  with `invalid-config-flag`: `--config was given an empty value. Next:
  pass the configuration file's path (--config path/to/hejbro.config.ts),
  or drop the flag to use ./hejbro.config.ts.` `lastFlagValue` treats a
  trailing `--config` with no value as `""` (refused the same way)
  rather than as "flag absent".
- **Shape, path.** `loadConfig` runs `probePath(cwd, configPath)` before
  importing. `absent` → `config-not-found`: flagless text unchanged;
  under a flag: `no configuration file was found at
  "sub/hejbro.config.ts". Next: run \`hejbro init --config
  sub/hejbro.config.ts\` to scaffold it there, with a migrations
  directory and an empty snapshot file, then add a declaration file and
  rerun \`hejbro generate\`.` `present`/directory and `dangling` →
  `config-not-a-file`: `"hejbro.config.ts" is the configuration path,
  but a directory is there — the configuration is a file hejbro reads.
  Next: move or remove the existing directory at "hejbro.config.ts", or
  name another file with --config, then rerun.` (dangling: `but a
  dangling symbolic link is there, pointing at "x". Next: remove the
  link or create its target, or name another file with --config, then
  rerun.`). `ancestor-file`, `ancestor-dangling`, `blocked`,
  `stat-failed` → `config-unreadable` with D3's sentences, the subject
  being `the configuration path`. The two leaf sentences (directory,
  dangling link) live in one place (`loader.ts`, exported, tail as a
  parameter) so `init` throws the same words under `init-path-conflict`
  with `then rerun \`hejbro init\``. The ancestor cases are not shared:
  `init` keeps its own ancestor templates for every artifact — the
  refusal for `--config f/h.ts` reads exactly like the one for
  `migrationsDir: "f/mig"` (`"f" was expected to be a directory to hold
  the configuration file, but a file is there. Next: move or remove the
  existing file at "f", then rerun \`hejbro init\`.`), which is the
  parity the scenario names — node and remedy, not the sentence. The
  `--config` value `config-not-found`'s `Next:` echoes is the one the
  user typed, as typed — D57's relativization is for paths hejbro
  discovered, never for a path the user supplied; the header and the
  message label stay relative to the working directory as every report
  line does. An ancestor that is a file or a dangling link carries no
  operating-system code on any side: that is a judgement of kind, and
  the code belongs only to a look-up the operating system refused.
- **Shape, init phrasing.** The configuration artifact's messages open
  with `"<path>" is the configuration path` instead of `"<path>" was
  expected to be a file for hejbro.config.ts`; ancestor messages say `to
  hold the configuration file`. Implementation: the `Artifact` carries a
  `subject` clause per role (`for snapshotPath` / `the configuration
  path`), and each `throw*` composes from it.

## D6 — Nesting wording (NB5)

`throwNestedPathConflict` receives the held artifact's kind and both
roles: `"hejbro.config.ts" is the configuration path, and snapshotPath
("hejbro.config.ts/state.json") would have to be created inside it — a
file cannot hold a file. Next: point snapshotPath outside
"hejbro.config.ts", then rerun \`hejbro init\`.`; `"state.json" is
named by snapshotPath, and the configuration path
("state.json/hejbro.config.ts") would have to be created inside it — a
file cannot hold a file. Next: name a configuration file outside
snapshotPath with --config, or point snapshotPath elsewhere, then rerun
\`hejbro init\`.` The existing snapshot-holds-migrations sentence keeps
its words (`a file cannot hold a directory`, `point snapshotPath at a
file outside migrationsDir`).

## D7 — No diagnostics delta

`init-path-conflict`, `invalid-config`, `config-not-found`,
`snapshot-not-a-file`, `snapshot-unreadable` are reused; the new codes
are governed by the diagnostics requirement (a code plus a `Next:`), and
the skill reference names every code a configured path can raise.

## Foreign input

Configuration files, argv and a filesystem — the piece reviewer runs in
constructor mode (D110) under `/private/tmp/review-cp-*`, through the
built `packages/cli/dist/cli.js`, comparing `init` against the read side
on the same trees.
