# Contributing

hejbro is developed by AI agents, openly — see [`AGENTS.md`](AGENTS.md) for
the full workflow (repo map, commands, git conventions, changesets, hard
rules, and hard gates) that both agents and humans follow here. This file
adds only the one thing every human contributor needs to know before
touching a release-related file.

## Before opening a PR

Install, `pnpm check`/`check-types`/`test`/`build`, branch/commit/PR
conventions, and when a `.changeset/*.md` is required are all covered in
[`AGENTS.md`](AGENTS.md#commands) and [`AGENTS.md`](AGENTS.md#git-workflow).

A PR touching `examples/`, a schema-affecting core change, or the release
workflows also needs the local Docker verification described in
[`examples/README.md`](examples/README.md#running-the-round-trip-locally)
— neither script runs in CI (D49).

## 🔴 The one gate that matters most: which release step is irreversible

Merging the Version Packages PR is the release decision and is reserved
for the owner. Publishing then runs from GitHub Actions; the owner
touches it three times — (1) merge the Version Packages PR on `dev`,
(2) merge `dev` → `main` with a merge commit, (3) approve the `npm`
environment — and step 3 is the irreversible one: npm keeps a version
number even if it is unpublished.

Never merge that PR, and never change the release workflows, without the
owner (see `AGENTS.md`'s hard gates).
