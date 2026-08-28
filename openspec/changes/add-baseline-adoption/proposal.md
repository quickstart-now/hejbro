# Proposal: add-baseline-adoption

## Why

hejbro cannot be adopted by a project that already has a database, which
is most projects (#385). Declaring the existing schema exactly still makes
the first `generate` emit a full `create table …` for every object, and
applying that to a populated database fails on the first statement.

The skills guide documents the workaround — treat the first migration as a
baseline, register it as applied in your own apply tool — and that
workaround is correct. What is missing is that hejbro says none of it:
nothing in the emitted file or the command's output distinguishes "this is
your database's starting point, do not run it" from "run this". The user
finds out by running it and reading `relation "posts" already exists`.

## What Changes

- **`hejbro baseline`**, a first-class adoption command. Same pipeline as
  `generate` — a baseline IS a first migration, and everything about how
  it is built, hashed and chained has to stay identical or `verify` would
  reject it — with three differences:
  - it refuses unless the project has no migrations and an empty
    snapshot (`baseline-not-first`), naming `generate` for the other case
  - the emitted migration carries a `-- baseline:` banner line
  - the report states the registration step before the user can run the
    file
- **A banner marker in core.** `renderBanner` takes an optional
  `baseline` flag and renders one line directly under the version line,
  so it is the first thing anyone opening the file reads.

## Capabilities

### New Capabilities

- `cli-commands`: the adoption path. The CLI's command surface had no
  spec; this change is the first to touch it, so it gets exactly the
  requirement it adds (D87).

## Impact

- **Affected code**: `packages/core` (`sql/migration-file.ts`'s banner,
  `engine/generate.ts`'s option), `packages/cli`
  (`commands/generate.ts`'s mode + guard + report, `main.ts`'s
  subcommand), `skills/hejbro/references/brownfield-adoption.md`.
- **Breaking**: none. `generate` is unchanged; `baseline` is new.
- **Decision log**: no new row. D12 (hejbro does not apply migrations)
  is what makes registration the user's pipeline's job, and this change
  respects it rather than revisiting it.

## The decision this settles

#385 listed three directions and left them for proposal time. This
settles it: **an explicit baseline concept**, not introspection-assisted
seeding, and not documentation-only.

- *Documentation-only* was already tried — the guide says the right
  thing today and the product still hands the user an unmarked file that
  fails when run. Guidance the artifact contradicts is not guidance.
- *Introspection* is a much larger surface (a live connection or a dump
  parser, plus a declaration writer, plus the question of what it does
  with types it cannot infer) and it is not what unblocks adoption:
  writing declarations is work a user can do, and running a migration
  that cannot succeed is not. Introspection stays open as the other half
  of #385.
- *Baseline* is small because the machinery already exists — the honest
  part is saying out loud what the file is.

## Out of scope

Nothing parses the marker programmatically yet. A `verify`/`history`
readout, or an apply-tool integration, can add one when there is a
consumer; exporting a detector nothing calls would be dead surface.
