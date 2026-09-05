# Proposal: harden-config-paths-2 (#846, #820, #830, #831)

## Why

`harden-init-paths` taught `init` to judge every configured path before
creating anything, and taught the commands that read the snapshot to
refuse a directory or an unreadable file by name. Its adversarial review
and the constructed-input piece review then found the places where the
two sides still answer one tree two ways, or where a raw stack still
gets out:

- The read side stats the separator-stripped snapshot path but reads the
  spelled one, so `snapshotPath: "state.json/"` over a real file reports
  `snapshot-unreadable (ENOTDIR)` with a permissions `Next:`, while
  `init` answers the same configuration with "drop the trailing slash".
  A dangling link at the snapshot path reads as absent on the read side
  — `snapshot-not-found`, `Next: run hejbro init` — and `init` refuses
  that tree. A file on the way (`f/state.json`, `f` a file) is named by
  the leaf as a thing to check permissions on (#846 NB2, NB6).
- `init --config f/h.ts` with a file at `f` checks the configuration
  artifact's own kind before its ancestors and names `f/h.ts` — a path
  that does not exist — with a bare `ENOTDIR`; every other artifact is
  named by the ancestor that blocks (#846 NB3).
- The nesting refusal covers every artifact pair but says "a file cannot
  hold a directory" for a file-holds-file case, and its `Next:` tells the
  user to repoint `hejbro.config.ts`, which no field controls (#846
  NB5). Every refusal about the configuration file's own path reads
  `"hejbro.config.ts" … for hejbro.config.ts` — the label and the field
  name are the same word (#831).
- `--config=` resolves to the working directory, and the refusal that
  follows tells the user to move or remove `.` (#846 NB8).
- A `migrationsDir` that is a file crashes every command that lists it
  with a raw `ENOTDIR` and an absolute path — the mirror of the
  directory-at-snapshot refusal the previous change added (#820).
- `config-not-found` hard-codes `hejbro.config.ts` in its `Next:` even
  when `--config` pointed elsewhere, so the user is told to create a file
  they never asked for (#830). A directory at the configuration path
  reaches the loader and fails as an import-resolution diagnostic.

## What Changes

- A `snapshotPath` whose spelling names a directory (trailing separator,
  empty, last segment `.`/`..`) is refused when the configuration is
  read, by every command, with `invalid-config` naming the field — the
  same treatment an absolute-looking value already gets. `init`'s own
  trailing-separator refusal for that field becomes unreachable and goes.
- One path judgement, shared by `init` and the read side: ancestors
  first (a file, a dangling link, a closed directory on the way names
  that node), then the leaf (a link judged by its target). `init` applies
  it to the configuration artifact too. The snapshot reader maps its
  outcomes to `snapshot-not-a-file` (directory, dangling link) and
  `snapshot-unreadable` (permission, file or link on the way, unreadable
  file), and reads the stripped path it stat'd.
- The migrations-directory listing every command shares judges the path
  the same way: `migrations-dir-not-a-directory` for a file or a
  dangling link there, `migrations-dir-unreadable` for a path that cannot
  be inspected or listed; nothing there stays "no migrations".
- `--config`: an empty or whitespace-only value is refused with
  `invalid-config-flag` by the one resolver every command shares. The
  loader judges the resolved path before loading: absent →
  `config-not-found` naming the path looked up and `hejbro init --config
  <same value>` (the flagless text is byte-unchanged); a directory or a
  dangling link → `config-not-a-file`; a path that cannot be inspected →
  `config-unreadable`. `init` refuses the same trees with the same
  sentences under `init-path-conflict`.
- `init`'s configuration-path refusals describe the path as the
  configuration path (name once); the nesting refusal states the held
  artifact's kind and its `Next:` names the field the user can move, or
  `--config` where the configuration file is one of the pair.
- One `patch` changeset (`hejbro`); the skill reference's "a configured
  path can refuse the run" paragraph gains the four new codes.

Out of scope, same files, deliberately: `--config` on `verify`, `check`,
`migrate`, `status`, `reset`, `restore` and a single root (#819);
`raise --file` (#837); the configuration path inside `invalid-config`
messages (#745).

## Capabilities

- `cli-commands` — MODIFIED: `init` scaffolds what is missing, where the
  configuration says (ancestor-before-leaf for every artifact, nesting
  wording and `Next:`, configuration-path phrasing, empty `--config`);
  MODIFIED: a configured artifact path is relative to the working
  directory (`snapshotPath` spelled as a directory refused at read);
  MODIFIED: a snapshot that cannot be read as a file is refused before it
  is read (links and ancestors judged as `init` judges them); ADDED: a
  migrations directory that cannot be listed is refused before it is
  read; ADDED: the `--config` flag names a file.
- `diagnostics` — no delta: the four new codes
  (`migrations-dir-not-a-directory`, `migrations-dir-unreadable`,
  `config-not-a-file`, `config-unreadable`) and `invalid-config-flag` are
  governed by the existing requirement (a code plus a `Next:`). One
  input changes code: `snapshotPath: "state.json/"` moves from `init`'s
  `init-path-conflict` to `invalid-config`, because it is a spelling
  fault every command now refuses before looking at the disk.

## Impact

- `packages/cli/src/path-probe.ts` (the leaf probe moves in; a composed
  ancestors-then-leaf judgement), `packages/cli/src/commands/init.ts`
  (one check over the shared judgement, wording), `packages/cli/src/snapshot-file.ts`
  (snapshot outcomes, `listMigrationFiles(cwd, migrationsDir)`),
  `packages/cli/src/loader.ts` (empty flag, path judgement,
  `config-not-found` text under a flag), `packages/cli/src/config.ts`
  (`snapshotPath` spelling); one call line each in
  `packages/cli/src/commands/{generate,verify,history,migrate,status,restore}.ts`.
- Tests: `packages/cli/test/{init,config,loader,generate-command}.test.ts`.
- `skills/hejbro/references/generate-verify-workflow.md`;
  `.changeset/harden-config-paths-2.md` (`patch`).
- Refs #846, #820, #830, #831.
