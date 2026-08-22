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

## 🔴 The one gate that matters most: merging the Version PR publishes

The release pipeline (`.github/workflows/release-version.yml`,
`release-publish.yml`) opens and updates a "Version Packages" PR on every
`dev` push that has pending changesets. **Merging that PR is not a normal
merge** — it starts the chain that publishes `@hejbro/core`, `hejbro`, and
`@hejbro/supabase` to npm, **immediately and irreversibly**: npm never
lets the same version number publish twice, published or not, so even an
unpublish burns that version forever.

This is why merging the Version Packages PR is an **owner-only action**
(see `AGENTS.md`'s hard gates) — never merge it, and never change the
release workflows, without the project owner.
