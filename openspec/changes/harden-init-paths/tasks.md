# Tasks: harden-init-paths

One group, one team (`ip`), sequential. Estimates are pure work minutes.
Every task starts from its named red test; a universal claim starts from
an input table, one real temporary project per row (D110). Verification
(gates, `openspec validate --strict`, `show --diff`) is the definition of
done, never a task. Tracking issues are the bug issues themselves (#741,
#743, #766, #768).

## 1. init's paths mean what the configuration says (#741, #743, #766, #768)

Files this group owns: `packages/cli/src/commands/init.ts`,
`packages/cli/src/config.ts`, `packages/cli/src/loader.ts` (one export,
no behaviour change), `packages/cli/src/snapshot-file.ts`,
`packages/cli/test/init.test.ts`, `packages/cli/test/config.test.ts`,
`packages/cli/test/generate-command.test.ts` (two cases),
`packages/cli/test/help.test.ts` (one case),
`skills/hejbro/references/generate-verify-workflow.md`,
`.changeset/harden-init-paths.md`.

- [ ] 1.1 (~10m) `[design]` `init` reads — or writes — the configuration
      `--config` names, and scaffolds where its fields say (#741, D1).
      Red: `packages/cli/test/init.test.ts` — "honours --config: reads
      the configuration it names and scaffolds where its fields say".
      Input table (`--config` location × what sits there), in-process
      through `runInit(cwd, rawArgs)` except the two rows marked
      subprocess, which spawn the built CLI from a `createCliFixtureDir`:

      | `--config` | at that path | expected |
      |---|---|---|
      | omitted | `hejbro.config.ts` present | as today (control) |
      | `hejbro.config.ts` | present | identical to the omitted row |
      | `sub/hejbro.config.ts` | present, names `db/mig` + `db/state.json` | `skipped sub/hejbro.config.ts (exists)`, `created db/mig/`, `created db/state.json` — under cwd; nothing under `sub/`, nothing at `migrations/` or `hejbro.snapshot.json` |
      | `sub/hejbro.config.ts` | absent (no `sub/` either) | `created sub/hejbro.config.ts`, `created migrations/`, `created hejbro.snapshot.json`; no `hejbro.config.ts` at cwd |
      | `../other/hejbro.config.ts` | present, names `mig` | `skipped ../other/hejbro.config.ts (exists)`, `created mig/` under cwd |
      | `../other/hejbro.config.ts` | absent | `created ../other/hejbro.config.ts` + the two defaults under cwd |
      | an absolute path | present | every report line names it relative to cwd; no absolute path in the output |
      | `sub/hejbro.config.ts` | a directory | `init-path-conflict` naming `sub/hejbro.config.ts`, nothing created |
      | `sub/hejbro.config.ts` | unresolvable import | `config-load-failed`, stderr byte-identical to `hejbro generate --config sub/hejbro.config.ts`'s (subprocess) |
      | `--config=sub/hejbro.config.ts` | present, names `db/mig` | same as the space form (subprocess) |
      | `sub/hejbro.config.ts` | present, names `db/mig` + `db/state.json`, with a declaration file | after `init`, `generate --config sub/hejbro.config.ts` writes into `db/mig/` and `db/state.json` — the pin for "resolved exactly as" (subprocess) |

      Green: `initCommand` gains `args.config` (same description text as
      `history`), runs `normalizeEqualsFlags` and `lastFlagValue`, and
      calls `runInit(cwd, rawArgs)` (default `[]` keeps every existing
      call). `loader.ts` exports `resolveConfigPath`; `init` uses it for
      the config artifact's path and passes the flag to `loadConfig`.
      The config artifact's label is `fileLabel(cwd, configPath)`.
      Files: `init.ts`, `loader.ts`, `init.test.ts`.

- [ ] 1.2 (~8m) `[design]` An absolute-looking `migrationsDir` or
      `snapshotPath` is refused when the configuration is read (#743,
      D2). Red: `packages/cli/test/config.test.ts` — "refuses an
      artifact path spelled as absolute, naming the field". Input table:

      | field | value | expected |
      |---|---|---|
      | `migrationsDir` | `"/db/migrations"` | `invalid-config` naming `migrationsDir` |
      | `snapshotPath` | `"/snap/state.json"` | `invalid-config` naming `snapshotPath` |
      | `migrationsDir` | `"//db"` | refused the same way |
      | `migrationsDir` | `"db/migrations"` | accepted (control) |
      | `migrationsDir` | `"./db/migrations"` | accepted (control) |
      | `migrationsDir` | `"../out/migrations"` | accepted (control) |
      | `snapshotPath` | `""` | accepted by the parser (control — `init`'s own kind check refuses it later, unchanged) |

      Then the two `/…` rows in `init.test.ts:143-148,191-196` move from
      "created under cwd" to "refused, exit 1, nothing created" — the
      previous change's D2 pin is replaced, not silently dropped — and
      `generate-command.test.ts` gains one subprocess case: a
      configuration with `migrationsDir: "/db/migrations"` → exit 1,
      `invalid-config`, nothing written. Green: a `superRefine` (or a
      post-parse check beside `findInvalidPresetIndex`) in `parseConfig`
      refusing a value that `isAbsolute` accepts, message in
      `describeIssue`'s own style with a `Next:` naming the relative
      spelling; no configuration path in the new message (#745 is next).
      Files: `config.ts`, `config.test.ts`, `init.test.ts`,
      `generate-command.test.ts`.

- [ ] 1.3 (~8m) `[design]` A planned snapshot file that would have to
      hold the migrations directory is refused before anything is
      created (#766, D3). Red: `packages/cli/test/init.test.ts` —
      "refuses a configuration whose snapshot path would have to hold
      the migrations directory". Input table:

      | `migrationsDir` | `snapshotPath` | on disk | expected |
      |---|---|---|---|
      | `"mig/sub"` | `"mig"` | nothing | `init-path-conflict` naming both fields and `mig`, exit 1, nothing created, no `skipped` line |
      | `"snap.json/mig"` | `"snap.json"` | nothing | the same refusal |
      | `"a/b/c"` | `"a"` | nothing | the same refusal — any depth |
      | `"mig/sub/"` | `"mig/"` | nothing | the same refusal — spellings, not strings |
      | `"./mig/sub"` | `"mig"` | nothing | the same refusal |
      | `"mig"` | `"mig/state.json"` | nothing | both created, exit 0 (control: a directory holds a file) |
      | `"migrations"` | `"migrations-state.json"` | nothing | both created (control: a shared prefix is not nesting) |
      | `"mig/sub"` | `"mig"` | a directory at `mig` | the wrong-kind refusal as today, message unchanged (control: the existing check answers first) |
      | `"mig/sub"` | `"mig"` | a regular file at `mig` | the ancestor refusal as today (control) |

      Green: `checkNoNestedPaths` beside `checkNoDuplicatePaths`, over
      the same `artifactPairs`, refusing when a file artifact's
      separator-stripped path is a strict ancestor of another planned
      path (`relative(file, other)` non-empty, not starting with `..`,
      not absolute). Runs after the duplicate check, before the
      ancestor walk. Files: `init.ts`, `init.test.ts`.

- [ ] 1.3b (~6m) `[design]` A directory at the snapshot path is refused
      before it is read (#766 second ask, D3b). Red:
      `packages/cli/test/generate-command.test.ts` — "refuses a directory
      at the snapshot path with snapshot-not-a-file, never EISDIR"
      (subprocess, built CLI). Input table:

      | command | at `snapshotPath` | expected |
      |---|---|---|
      | `generate` | a directory | exit 1, `error[snapshot-not-a-file]`, message names the configured path, `Next:` present, no `EISDIR` in stderr, no migration written |
      | `verify` | a directory | the same code and message |
      | `generate` | a directory at `snapshotPath: "db/state.json/"`-style spelling | the same refusal (trailing separator stripped before the stat, as `init` does) |
      | `generate` | a regular file (control) | reads it as today |
      | `generate` | nothing, no migrations (control) | `snapshot-not-found`, text unchanged |

      Green: `readSnapshotFileText` stats the separator-stripped path
      first; `isDirectory()` → `throwHejbroError("snapshot-not-a-file",
      …)` with the wording in `design.md`; `ENOENT` falls through to the
      existing two branches; any other stat failure keeps today's
      behaviour (#767's class). Files: `snapshot-file.ts`,
      `generate-command.test.ts`.

- [ ] 1.4 (~9m) `[design]` A permission-blocked check names the
      directory that blocks it (#768, D4). Red:
      `packages/cli/test/init.test.ts` — "names the ancestor whose
      permissions block the check, never the missing leaf". Input table
      (the whole describe skips when `process.getuid?.() === 0`; every
      row restores mode 755 in `afterEach` before the fixture is removed):

      | field | value | on disk | message and `Next:` name |
      |---|---|---|---|
      | `migrationsDir` | `"nx/mig"` | `nx` mode 000 | `nx` |
      | `migrationsDir` | `"nx/a/mig"` | `nx` mode 000 | `nx` — the walk continues past the `EACCES` at `nx/a` |
      | `snapshotPath` | `"nx/state.json"` | `nx` mode 000 | `nx` |
      | `migrationsDir` | `"nx/mig"` | `nx/mig` created, then `nx` mode 000 | `nx` (an existing leaf is no different — the look-up is what fails) |
      | `migrationsDir` | `"ro/mig"` | `ro` mode 555 holding `mig` | `skipped ro/mig/ (exists)` (control: read-only is inspectable) |
      | `migrationsDir` | `"loop/mig"` | `loop` a symlink to itself | the refusal names `loop` (`ELOOP`) as today (control: a non-permission code keeps the failing node) |
      | `migrationsDir` | `"mig"` | a regular file at `mig`, mode 000 | the wrong-kind refusal naming `mig` (control: `stat` needs no permission on the node itself) |

      Green: `walkAncestors` continues upward past `EACCES`/`EPERM`,
      carrying that a permission failure occurred, and returns the
      ancestor it finally stat'd as the blocking node; `checkPathKind`'s
      stat-failed branch asks the same walk for the culprit;
      `throwStatFailed(label, fieldName, code, culprit)` names it in the
      message and the `Next:`. The comment states the one constraint:
      `stat`'s `EACCES` is always a directory on the way, never the leaf.
      Files: `init.ts`, `init.test.ts`.

- [ ] 1.5 (~6m) The surface is documented and the release note written.
      Red: `packages/cli/test/help.test.ts` — "init --help lists
      --config" (subprocess, same shape as the `baseline --help` case).
      Then: the `hejbro init` sentence in
      `skills/hejbro/references/generate-verify-workflow.md` says
      `--config <path>` names the configuration file as it does for
      `generate`, and that the migrations directory and snapshot stay
      relative to the working directory; `.changeset/harden-init-paths.md`
      (`patch`, `hejbro`) — one paragraph in user-facing terms covering
      the five fixes (`snapshot-not-a-file` named, since a new code is a
      public surface). Files: `help.test.ts`, that reference, the
      changeset.

Group close: `openspec validate harden-init-paths --strict` and
`show --diff` with the MODIFIED requirement classified MODIFIED and no
scenario dropped or renamed; the CI-derived gate sweep with
`TURBO_FORCE=1` in the worktree; `openspec/task-times.csv` rows and the
README badge restamp (`pnpm check:tasktime`, `pnpm check:crap`); then
the reviewer is requested (constructor mode, #412/R3).
