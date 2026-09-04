# Proposal: harden-init-paths (#741, #743, #766, #768, #767)

## Why

Four defects sit on `hejbro init`'s path handling, each one either
scaffolding a project nothing else reads or answering a broken layout
with the wrong words:

- `hejbro init --config <path>` ignores the flag. `generate`, `baseline`
  and `history` resolve `--config` to the file it names; `init` defines
  no arguments at all, reads `./hejbro.config.ts` (or scaffolds one), and
  so a repository whose configuration lives elsewhere gets a second,
  competing project at the working directory (#741).
- `init` and `generate` name the same file two ways. A configured value
  spelled absolute (`migrationsDir: "/db/migrations"`) is joined under
  the working directory by every command — `path.join` swallows the
  leading `/` — so `init` reports `created db/migrations/` while
  `generate` prints `wrote /db/migrations/0001_….sql`, a path that does
  not exist. The value never meant what it said, and no command says so
  (#743).
- A configuration whose snapshot path would have to *hold* the migrations
  directory (`snapshotPath: "mig"`, `migrationsDir: "mig/sub"`) passes
  every pre-creation check: the duplicate check compares for equality
  only. `init` creates `mig/sub/`, then reports `skipped mig (exists)` —
  the directory it just made, taken for the snapshot — and `generate`
  dies with a raw `EISDIR` reading it (#766).
- When a directory on the way to a configured path cannot be looked
  inside (`nx` with mode 000, `migrationsDir: "nx/mig"`), the refusal is
  coded but its `Next:` says *check permissions on "nx/mig/"* — a path
  that does not exist. The node whose permissions block the check is
  `nx`; `stat`'s `EACCES` is always about a directory on the way, never
  about the leaf (#768).

## What Changes

- `init` accepts `--config <path>`, resolved exactly as `generate`
  resolves it, reads the configuration there (or writes it there when
  nothing sits at that path), and reports it by its path relative to the
  working directory. The migrations directory and the snapshot stay
  resolved against the working directory — exactly as the commands that
  consume those fields resolve them — so `init --config X` and
  `generate --config X` act on the same files by construction.
- A `migrationsDir` or `snapshotPath` spelled as an absolute path is
  refused when the configuration is read, by every command, with
  `invalid-config` naming the field: these fields are relative to the
  working directory, and a value the tool would silently re-root is
  refused rather than reinterpreted.
- `init` refuses, before creating anything, a configuration whose planned
  snapshot file would have to hold another planned artifact — the
  migrations directory inside the snapshot path, at any depth, under any
  spelling — with the same `init-path-conflict` code the duplicate-path
  refusal carries, naming both fields. A snapshot inside the migrations
  directory stays legitimate.
- The commands that read the snapshot (`generate`, `baseline`, `verify`,
  `check`) refuse a directory at the snapshot path with a new code,
  `snapshot-not-a-file`, before reading — never a raw `EISDIR`. The
  mirror case, a file at the migrations directory, is #820 in the next
  batch.
- A stat failure caused by permissions names the directory that blocks
  the look-up — the deepest ancestor the run could still inspect — in
  both the message and the `Next:` line, whether the failure surfaced at
  the leaf or while walking the ancestors. Other stat failures keep
  naming the node that failed.
- One `patch` changeset (`hejbro`); one sentence in
  `skills/hejbro/references/generate-verify-workflow.md` for `init
  --config`.

- The piece review's constructed inputs (folded in by ruling, with #767):
  a parent the process cannot write into is refused before anything is
  created, and a creation that still fails is reported coded and undone
  so the tree is as the run found it; a snapshot file the process cannot
  read is refused with `snapshot-unreadable` by every read-side command;
  a dangling symbolic link at an artifact path is refused as the wrong
  kind instead of being written through.

Out of scope, on the same files, deliberately left for the next batch:
the absolute configuration path inside `invalid-config` messages (#745).

## Capabilities

- `cli-commands` — MODIFIED: `init` scaffolds what is missing, where the
  configuration says (`--config`, nested-path refusal, blocking-ancestor
  naming); ADDED: a configured artifact path is relative to the working
  directory; ADDED: a snapshot that cannot be read as a file is refused
  before it is read.
- `diagnostics` — no delta: `init-path-conflict`, `invalid-config` and
  `config-load-failed` are reused, and the two new codes
  (`snapshot-not-a-file`, `snapshot-unreadable`) are governed by the
  existing requirement (a code plus a `Next:`).

## Impact

- `packages/cli/src/commands/init.ts` (`--config`, nesting check,
  blocking-ancestor naming), `packages/cli/src/loader.ts` (export the
  config-path resolver `init` shares with `loadConfig` — no behaviour
  change), `packages/cli/src/config.ts` (absolute-path refusal),
  `packages/cli/src/snapshot-file.ts` (directory-at-snapshot refusal),
  `packages/cli/test/init.test.ts`, `packages/cli/test/config.test.ts`,
  `packages/cli/test/generate-command.test.ts` (two refusal cases),
  `packages/cli/test/help.test.ts` (`init --help` lists `--config`).
- `skills/hejbro/references/generate-verify-workflow.md`;
  `.changeset/harden-init-paths.md` (`patch`).
- Refs #741, #743, #766, #768, #767.
