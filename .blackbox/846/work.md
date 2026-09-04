# Work — quickstart-now/hejbro#846

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Read side judges paths as init does; config artifact ancestors first; nesting wording; empty --config refused

_2026-09-04T22:28Z_

Read side judges paths as init does; config artifact ancestors first; nesting wording; empty --config refused

Built on `path-probe.ts`'s `probePath(cwd, leafPath)` (D2): walks ancestors first (a file, a dangling link, or a permission-blocked directory on the way is named as that node), then judges the leaf itself, including through a symbolic link. `init`'s own `checkAncestors` + `checkPathKind` were folded into one `checkArtifactPath` over `probePath`, run for the configuration artifact before the loader runs and for every planned artifact after — this is the fix for NB3 (`--config f/h.ts` with `f` a file used to name the non-existent leaf `f/h.ts` with a bare `ENOTDIR` instead of the ancestor `f`).

`snapshot-file.ts`'s `readSnapshotFileText` (NB2, NB6) and `listMigrationFiles` (see #820) now consume the same `probePath` outcome instead of their own `statSync`-only probes, so a dangling link at `snapshotPath`/`migrationsDir` is refused by name instead of being read as absent, and a file/link ancestor on the way is named instead of reported as an unrelated permissions failure.

`loader.ts` gained `configFlagFrom` (a trailing `--config` with no value, or `--config=`, is `""`, refused with `invalid-config-flag` before any path is resolved — NB8: this used to resolve silently to the working directory and refuse it as an existing "directory") and `resolveConfigPath`/`loadConfig` now judge the resolved configuration path with `probePath` before ever handing it to jiti, so a directory or a dangling link there is refused with `config-not-a-file`/`config-unreadable` naming the real node instead of surfacing as `config-load-failed` with a leaked absolute path (measured: `generate --config=` on dev 2b7fd901 produced `error[config-load-failed]: Cannot find module '/private/var/.../hejbro-cli-XXXXXX'`).

`init.ts`'s own refusal for the configuration artifact now opens with `"<path>" is the configuration path` (shared sentence with `loader.ts`'s exported `configNotAFileMessage`, different tail) instead of repeating the field's own name a second time; ancestor conflicts on the configuration artifact keep `init`'s existing sentence shape with the subject "the configuration file". `throwNestedPathConflict` (NB5) now states the held artifact's real kind ("a file cannot hold a file", not always "a file cannot hold a directory") and, when the configuration artifact is one of the two, names `--config` in its `Next:`.

Commits: d2de22f7, cdfdfc86, ee456592, e8126845, 47ea44d6, f4f46d24, 9dcf170f, d9b7624f.

Representative test cases (packages/cli/test): config.test.ts "refuses a snapshotPath whose spelling names a directory, naming the field"; init.test.ts "judges the --config path by its ancestors before its own node", "the configuration path's own messages"; generate-command.test.ts "the snapshot path judged as init does"; loader.test.ts "loadConfig / resolveConfigPath — --config names a file".

