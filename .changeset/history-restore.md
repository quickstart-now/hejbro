---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

Adds two new CLI commands (#130): `hejbro history` lists every migration
with its commit, date, state (`ok`/`lost`/`rewritten`/`uncommitted`),
recorded snapshot hash, and subject line, computed purely from git
plumbing against `migrationsDir` — `--links`/`--no-links` add
GitHub/GitLab URL columns (or OSC8 terminal hyperlinks) for the origin
remote. `hejbro restore <n>` restores declaration files matching
`config.entry`'s glob back to migration `<n>`'s recorded state, guarding
against a dirty working tree, an out-of-range target, and a
lost/rewritten history state, then verifying the restored declarations
reload, their format version pre-checks, and re-serializing them
reproduces migration `<n>`'s recorded snapshot hash — reporting a
colorized file-diff and the exact `git`/`rm` commands to undo it.

Both commands are read/git-only: `@hejbro/core` is unchanged, and
`packages/cli/src/git.ts` is the only module that spawns git
subprocesses.
