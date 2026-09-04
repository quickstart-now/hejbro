# Work — quickstart-now/hejbro#820

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — listMigrationFiles refuses a non-directory by name across seven commands

_2026-09-04T22:28Z_

listMigrationFiles refuses a non-directory by name across seven commands

`snapshot-file.ts`'s `listMigrationFiles` changed signature from `(migrationsDirPath)` to `(cwd, migrationsDir)` and now consumes `path-probe.ts`'s `probePath(cwd, join(cwd, migrationsDir))` instead of `existsSync` + `readdirSync`. Outcomes: `absent` stays `[]` (unchanged contract — the commands that write into the directory still create it); `present`/directory lists as before, and a `readdirSync` failure on an inspectable-but-unlistable directory (mode 000 on the directory itself) is now `migrations-dir-unreadable` naming the configured path, instead of a raw thrown error; `present`/file is `migrations-dir-not-a-directory`; `dangling` is the same code with the field's own dangling sentence; `ancestor-file`/`ancestor-dangling`/`blocked`/`stat-failed` are `migrations-dir-unreadable` with the culprit named.

Six external call sites updated (one line each): `commands/generate.ts` (two calls — the baseline-first-run count and the pre-write previous-migration count), `commands/verify.ts`, `commands/history.ts`, `commands/migrate.ts`, `commands/status.ts`, `commands/restore.ts`; plus `snapshot-file.ts`'s own internal call inside `readSnapshotFileText`'s absent branch (seven call sites total, matching the seven commands the pinned tests cover: generate, verify, baseline, history, migrate, status, restore).

Measured (built CLI, dev 47ea44d6's parent, i.e. before this fix): a regular file at `migrationsDir` crashed `history`/`status`/`migrate` with a raw `Error: ENOTDIR: not a directory, scandir '<absolute path>/migrations'` including the process's own stack trace and an absolute path; a dangling link at `migrationsDir` crashed `generate` with a raw `Error: ENOENT: no such file or directory, mkdir` when the write step later tried to create through it (the listing itself silently read it as `absent` under the old `existsSync`-based check); a mode-000 `migrationsDir` crashed `generate` with a raw `EACCES` from `readdirSync`.

Coverage gap disclosed (not fixed, out of this piece's table): `restore`'s own row is not in tasks.md's original input table for this change (the table lists generate/verify/baseline/history/status/migrate); a dedicated pin ("a regular file at migrationsDir is refused with migrations-dir-not-a-directory, never ENOTDIR") was added to `restore-command.test.ts` as a follow-up commit (f4f46d24) once the gap was noticed, closing it for this call site too.

Commit: 47ea44d6 (+ f4f46d24 for the restore pin).

Representative test cases: generate-command.test.ts "refuses a migrations directory that is not a directory with its own code, never ENOTDIR"; restore-command.test.ts "a regular file at migrationsDir is refused with migrations-dir-not-a-directory, never ENOTDIR".

