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

## Reporting a problem

Use the **Bug report** issue template (`.github/ISSUE_TEMPLATE/`). What it
asks for is what a maintainer needs to reproduce without guessing:

- the hejbro version and the provider or driver (Postgres, Supabase, Neon,
  Nile — and the Postgres version when a database was involved);
- the smallest declaration and command that shows the problem;
- what you expected, and what actually happened — the generated SQL, the
  full diagnostic (its code and `Next:` line), or the server's error with
  its SQLSTATE.

One issue per defect is preferred: each gets its own fix, PR and close.
A batch of findings from one session is welcome too — file it as one
issue and the maintainers split it into sub-issues, as #750 was. Bug
reports carry the `bug` label; a missing capability is `enhancement`;
a docs gap is `documentation`.

## 🔴 The one gate that matters most: which release step is irreversible

Merging the Version Packages PR is the release decision and is reserved
for the owner. Publishing then runs from GitHub Actions; the owner
touches it three times — (1) merge the Version Packages PR on `dev`,
(2) merge `dev` → `main` with a merge commit, (3) approve the `npm`
environment — and step 3 is the irreversible one: npm keeps a version
number even if it is unpublished.

Never merge that PR, and never change the release workflows, without the
owner (see `AGENTS.md`'s hard gates).
