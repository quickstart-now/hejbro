# Tasks: harden-config-paths-2

One group, one team (`cp`), sequential. Estimates are pure work minutes.
Every task starts from its named red test; a universal claim starts from
an input table, one real temporary project per row (D110). Every task's
green includes `pnpm biome check` on the files it touched. Verification
(gates, `openspec validate --strict`, `show --diff`) is the definition of
done, never a task. Tracking issues are the bug issues themselves (#846,
#820, #830, #831). Permission rows skip under `process.getuid?.() === 0`
and restore modes in `afterEach` before the fixture is removed.

## 1. One configuration, one answer on every path (#846, #820, #830, #831)

Files this group owns: `packages/cli/src/path-probe.ts`,
`packages/cli/src/commands/init.ts`, `packages/cli/src/snapshot-file.ts`,
`packages/cli/src/loader.ts`, `packages/cli/src/config.ts`, one call line
each in `packages/cli/src/commands/{generate,verify,history,migrate,status,restore}.ts`,
`packages/cli/test/init.test.ts`, `packages/cli/test/config.test.ts`,
`packages/cli/test/loader.test.ts`,
`packages/cli/test/generate-command.test.ts`,
`skills/hejbro/references/generate-verify-workflow.md`,
`.changeset/harden-config-paths-2.md`.

- [x] 1.1 (~8m) `[design]` A `snapshotPath` spelled as a directory is
      refused when the configuration is read (D1). Red:
      `packages/cli/test/config.test.ts` — "refuses a snapshotPath whose
      spelling names a directory, naming the field". Input table:

      | field | value | expected |
      |---|---|---|
      | `snapshotPath` | `"state.json/"` | `invalid-config` naming `snapshotPath` |
      | `snapshotPath` | `"db/state.json//"` | refused the same way |
      | `snapshotPath` | `""` | refused the same way |
      | `snapshotPath` | `"."` | refused the same way |
      | `snapshotPath` | `"./"` | refused the same way |
      | `snapshotPath` | `".."` | refused the same way |
      | `snapshotPath` | `"db/.."` | refused the same way |
      | `snapshotPath` | `"state.json"` | accepted (control) |
      | `snapshotPath` | `"./db/state.json"` | accepted (control) |
      | `snapshotPath` | `"../up/state.json"` | accepted (control) |
      | `snapshotPath` | `"a.b/state.json"` | accepted (control: a dot inside a segment is not `.`) |
      | `migrationsDir` | `"mig/"` | accepted (control: a directory keeps the spelling) |
      | `migrationsDir` | `""` | accepted (control) |

      Then `generate-command.test.ts`'s `"db/state.json/"` row (in the
      `snapshot-not-a-file` table) moves to `invalid-config`, and
      `init.test.ts`'s trailing-separator-on-a-file rows (the `#687`
      path-kind describe's `snapshotPath: "x/"` cases) move from
      `init-path-conflict` to `invalid-config` — replaced, never
      dropped. Green: a post-parse check in `parseConfig` beside
      `absolutePathFields`; `throwSpelledAsDirectory` and the
      `endsWith("/")` branch in `checkPathKind` removed as unreachable.
      Files: `config.ts`, `init.ts`, `config.test.ts`, `init.test.ts`,
      `generate-command.test.ts`.

- [x] 1.2 (~9m) The path judgement is one function, and `init` applies
      it to the configuration artifact too (D2, NB3). Red:
      `packages/cli/test/init.test.ts` — "judges the --config path by its
      ancestors before its own node". Input table (in-process
      `runInit(cwd, ["--config", value])`):

      | `--config` | on disk | expected |
      |---|---|---|
      | `f/h.ts` | `f` a regular file | `init-path-conflict` whose message and `Next:` name `f` as the file to move — `f/h.ts` appears only as the artifact label, never in `Next:`; nothing created |
      | `lnk/h.ts` | `lnk → nowhere` | the ancestor dangling-link refusal naming `lnk` and `nowhere` |
      | `nx/h.ts` | `nx` mode 000 | the blocked refusal naming `nx` in the reason and `Next:` |
      | `nx/a/h.ts` | `nx` mode 000 | names `nx`, not `nx/a` |
      | `d/h.ts` | `d` an empty directory | `created d/h.ts` (control) |
      | `h.ts` | `h.ts → nowhere` | the leaf dangling-link refusal as today (control) |
      | omitted | `migrationsDir: "f/mig"`, `f` a file | the ancestor refusal naming `f`, message unchanged (control: the other artifacts' wording is the pin for the move) |

      Green: `statOutcomeAt` moves to `path-probe.ts`; `probePath(cwd,
      leaf)` composes ancestors then leaf and returns the deepest
      existing directory for an absent leaf; `init.ts` replaces
      `checkAncestors` + `checkPathKind` with one `checkArtifactPath`
      over it, run for the configuration artifact before the loader and
      for every planned artifact after; `checkWritable` and
      `firstNodeToCreate` read the outcome's parent. Every existing
      `init.test.ts` case is the pin for the pure move. Files:
      `path-probe.ts`, `init.ts`, `init.test.ts`.

- [x] 1.3 (~10m) `[design]` The snapshot reader judges links and
      ancestors as `init` does (D3, NB2, NB6). Red:
      `packages/cli/test/generate-command.test.ts` — "judges the snapshot
      path as init does: a link by its target, an ancestor by its kind"
      (subprocess, built CLI). Input table:

      | at `snapshotPath` | commands | expected |
      |---|---|---|
      | link → nowhere | `generate`, `baseline`, `verify`, `check` | exit 1, `error[snapshot-not-a-file]`, names the configured path and `nowhere`, no `snapshot-not-found`, nothing written at `nowhere` |
      | link → a directory | `generate` | `snapshot-not-a-file` as today (control) |
      | link → a regular snapshot file | `generate` | reads it (control) |
      | `f/state.json`, `f` a file | `generate`, `verify` | `error[snapshot-unreadable]`, message and `Next:` name `f`, never "check permissions on f/state.json" |
      | `lnk/state.json`, `lnk → nowhere` | `generate` | `snapshot-unreadable` naming `lnk` and `nowhere` |
      | `loop/state.json`, `loop → loop` | `generate` | `snapshot-unreadable` with `(ELOOP)` and `Next: check what "loop" points at` — no "permissions" |
      | `parent/state.json`, `parent` mode 000 | `generate` | `Next:` names `parent` as today (control) |
      | regular file, mode 000 | `generate` | `snapshot-unreadable (EACCES)` as today (control) |

      Every refusal row: no absolute path, no raw `ENOENT`/`ENOTDIR`
      line, and `hejbro init` on the same tree names the same node
      (asserted in the same row). Green: `readSnapshotFileText` over
      `probePath`, outcomes mapped as D3; the read uses the stripped
      path. Files: `snapshot-file.ts`, `generate-command.test.ts`.

- [x] 1.4 (~10m) `[design]` A migrations directory that cannot be
      listed is refused by name, never a raw `ENOTDIR` (D4, #820). Red:
      `packages/cli/test/generate-command.test.ts` — "refuses a
      migrations directory that is not a directory with its own code,
      never ENOTDIR" (subprocess, built CLI; `history` rows inside a
      `git init` fixture; `status`/`migrate` rows pass `--url
      postgres://127.0.0.1:1/x` — the listing precedes any connection,
      and a row that connects first is a tripwire, not a row to drop).
      Input table:

      | at `migrationsDir` | commands | expected |
      |---|---|---|
      | a regular file | `generate`, `verify`, `baseline`, `history`, `status`, `migrate`, `restore` | non-zero exit (each command's own precondition exit code), `error[migrations-dir-not-a-directory]`, names the configured path, `Next:` present, no `ENOTDIR` line, no absolute path, snapshot untouched |
      | link → nowhere | `generate` | `migrations-dir-not-a-directory` naming the path and `nowhere`; nothing written at `nowhere` |
      | link → a directory holding `0001_x.sql` | `generate` | listed through the link (control) |
      | `nx/mig`, `nx` mode 000 | `generate`, `verify` | `error[migrations-dir-unreadable]` with `(EACCES)`, `Next:` names `nx` |
      | `f/mig`, `f` a file | `generate` | `migrations-dir-unreadable`, message and `Next:` name `f` |
      | a directory, mode 000 | `generate` | `migrations-dir-unreadable (EACCES)` naming the directory itself ("cannot list it") |
      | nothing, empty snapshot present | `generate` with one declaration | writes the migration, creating the directory (control) |
      | nothing, `status --url …` | `status` | proceeds to the connection as today (control: absent is not a fault) |

      Green: `listMigrationFiles(cwd, migrationsDir)` over `probePath`;
      six call lines updated. Files: `snapshot-file.ts`, `generate.ts`,
      `verify.ts`, `history.ts`, `migrate.ts`, `status.ts`,
      `restore.ts`, `generate-command.test.ts`.

- [x] 1.5 (~10m) `[design]` `--config` names a file: an empty value is
      refused, and the path is judged before it is loaded (D5, #830,
      NB8). Red: `packages/cli/test/loader.test.ts` — "refuses an empty
      --config value and judges the configuration path before loading
      it". Input tables (in-process `loadConfig`; two subprocess rows in
      `generate-command.test.ts` and one in `init.test.ts` marked so):

      | `--config` value | expected |
      |---|---|
      | `""` | `invalid-config-flag`, `Next:` shows `--config path/to/hejbro.config.ts` |
      | `"   "` | refused the same way |
      | `--config=` (subprocess, `generate` and `init`) | the same refusal; `init` creates nothing; no "remove the existing directory at "."" |
      | `--config` as the last token (subprocess, `init`) | refused as empty, never silently the default |
      | `sub/h.ts`, absent | `config-not-found` naming `sub/h.ts`, `Next:` has `hejbro init --config sub/h.ts` |
      | absolute path outside cwd, absent | `config-not-found` naming it relative to cwd, no absolute path |
      | omitted, absent | the flagless text byte-identical to today (golden pin) |
      | `sub/h.ts` a directory | `config-not-a-file` naming `sub/h.ts` once, `Next:` mentions `--config` |
      | `.` (the working directory itself) | `config-not-a-file` naming `./`; no absolute path in the output (today: `config-load-failed` carrying the absolute working directory) |
      | omitted, `hejbro.config.ts` a directory | `config-not-a-file` |
      | `h.ts → nowhere` | `config-not-a-file` naming `h.ts` and `nowhere` |
      | `h.ts → real config file` | loads (control) |
      | `f/h.ts`, `f` a file | `config-unreadable`, message and `Next:` name `f` |
      | `nx/h.ts`, `nx` mode 000 | `config-unreadable (EACCES)`, `Next:` names `nx` |
      | `sub/h.ts`, present with an unresolvable import | `config-load-failed` as today (control) |

      Green: `resolveConfigPath` refuses a blank value; `lastFlagValue`
      in `init.ts` and `generate.ts`/`history.ts` yields `""` for a
      trailing flag; `loadConfig` probes before importing and throws
      through exported sentence builders `init` reuses. Files:
      `loader.ts`, `init.ts`, `generate.ts` (flag helper only),
      `history.ts` (flag helper only), `loader.test.ts`,
      `generate-command.test.ts`, `init.test.ts`.

- [x] 1.6 (~10m) `[design]` `init` names the configuration path once
      and states which kind a planned file cannot hold (D5 phrasing, D6,
      #831, NB5). Red: `packages/cli/test/init.test.ts` — "describes the
      configuration path without repeating its name, and a nested
      planned file by the held artifact's kind". Input table:

      | configuration / flag | on disk | expected message |
      |---|---|---|
      | omitted | a directory at `hejbro.config.ts` | `"hejbro.config.ts" is the configuration path, but a directory is there — the configuration is a file hejbro reads. Next: move or remove the existing directory at "hejbro.config.ts", or name another file with --config, then rerun \`hejbro init\`.` — `hejbro.config.ts` appears exactly twice (label and `Next:`), never as "for hejbro.config.ts" |
      | `--config sub/h.ts` | a directory at `sub/h.ts` | the same sentence naming `sub/h.ts` |
      | `--config h.ts` | `h.ts → nowhere` | `"h.ts" is the configuration path, but a dangling symbolic link is there, pointing at "nowhere". Next: …` |
      | `snapshotPath: "hejbro.config.ts/state.json"` | nothing | nested refusal, `a file cannot hold a file`, `Next: point snapshotPath outside "hejbro.config.ts"` |
      | `migrationsDir: "hejbro.config.ts/mig"` | nothing | `a file cannot hold a directory`, `Next: point migrationsDir outside "hejbro.config.ts"` |
      | `--config state.json/h.ts`, `snapshotPath: "state.json"` | only that configuration file (the value must be read for the pair to exist) | `a file cannot hold a file`, `Next:` names `--config` and `snapshotPath` |
      | `snapshotPath: "mig"`, `migrationsDir: "mig/sub"` | nothing | the existing sentence byte-unchanged (control) |
      | `--config f/h.ts` | `f` a file | ancestor refusal reads `to hold the configuration file` (from 1.2, wording pinned here) |

      Then the same sentences are asserted equal to `generate`'s under
      `config-not-a-file` for the first three rows (subprocess, both
      commands on one tree — the parity pin). Close:
      `skills/hejbro/references/generate-verify-workflow.md`'s "A
      configured path can refuse the run" paragraph names
      `migrations-dir-not-a-directory`, `migrations-dir-unreadable`,
      `config-not-a-file`, `config-unreadable`, `invalid-config-flag`
      and the `snapshotPath` spelling refusal in the file's own
      code-in-prose style; `.changeset/harden-config-paths-2.md`
      (`patch`, `hejbro`) — one paragraph in user-facing terms covering
      the four issues, naming every new code and the one code change
      (`snapshotPath: "x/"` under `init`). Files: `init.ts`,
      `init.test.ts`, that reference, the changeset.

Group close: `openspec validate harden-config-paths-2 --strict` and
`show --diff` (ADDED 2, MODIFIED 3, no scenario dropped or renamed); the
full gate sweep with `TURBO_FORCE=1` in the worktree after `pnpm build
--force`; `openspec/task-times.csv` rows 1.1–1.6 and the badge restamp
(`pnpm check:tasktime`, `pnpm check:crap`); blackbox `W1` on each of
#846, #820, #830, #831; then the reviewer is requested (constructor mode,
#412/R3).
