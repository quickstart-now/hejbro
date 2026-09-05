# Proposal: add-snapshot-upgrade (#413)

## Why

A newer hejbro that meets an older committed snapshot refuses it with
the pin-or-reset guidance: keep the old hejbro, or delete the snapshot
and the whole migration chain together and start from an empty
database. That was the honest contract while no released user existed.
Two releases now exist on two formats — 0.1.1 wrote format 5, the
0.2.0 pre-releases write format 8 — and the owner's ruling for the
0.2.0 line is that a real forward path must exist: a newer hejbro
reading an older committed snapshot moves the project forward without a
destructive reset. The downward direction stays a refusal.

What makes the path non-trivial is not the snapshot's content — the
declarations are the truth and the current decoder already reads every
released shape leniently — but the chain: the tip migration's banner
pins the snapshot's exact bytes, so re-encoding the snapshot alone
breaks `verify` and orphans `history`. The path has to re-encode the
snapshot **and** re-chain the tip, in one step, and leave `history`
able to find the tip's original commit afterwards.

## What Changes

- **Core re-encodes an older released format.** A pure function reads
  a snapshot whose format is one a released hejbro wrote (5 or later)
  through the current decoder's lenient rules and the canonical form,
  and renders it in the current format. It is idempotent, the identity
  on a current-format snapshot, and refuses formats older than any
  release (below 5, and the pre-`formatVersion` key) exactly as today.
- **The older-format diagnostic names the way forward.** For a format
  5-or-later snapshot every command's refusal ends with `Next: run
  hejbro upgrade`; the pin-or-reset guidance stays for a format no
  release ever wrote.
- **`hejbro upgrade` re-encodes and re-chains.** The command rewrites
  the snapshot file in the current format, rewrites the tip migration's
  `-- snapshot:` line to the new hash and records the old one under a
  new `-- upgraded-from:` banner line. It refuses, writing nothing,
  when the tip's recorded hash does not match the snapshot as stored —
  the chain was already broken and `verify` is the tool for that. With
  no migrations there is no tip; the snapshot alone is rewritten. A
  current-format snapshot is a no-op with exit 0. A newer-format
  snapshot is refused as today.
- **`history` and `restore` still resolve an upgraded tip.** The
  commit that added the tip carries the old-format snapshot, whose hash
  is now on the `-- upgraded-from:` line; `history` matches either
  hash, and `restore` rebuilds under the current format and compares
  with the current hash as it does for every migration. A public parser
  reads the new line by its prefix only.
- The decision log's stability row records the shipped path; the
  user-facing skill documents the command; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`snapshot-format`** — MODIFIED requirement: *A snapshot records the
  declared schema completely at format version 8* (the older-format
  refusal names the upgrade for a released format, pin-or-reset for an
  unreleased one). ADDED requirement: *An older released format is
  re-encoded into the current format*.
- **`cli-commands`** — ADDED requirement: *upgrade re-encodes the
  snapshot and re-chains the tip*.
- **`migration-format`** — MODIFIED requirement: *A migration's banner
  carries machine-readable chain and version lines* (the
  `-- upgraded-from:` line and its parser).

## Impact

- `@hejbro/core`: `snapshot/snapshot.ts` (the re-encoding entry and the
  split older-format message), `sql/migration-file.ts` (the banner line
  and its parser), the barrel and its export pin.
- `hejbro` (CLI): a new `commands/upgrade.ts`, `main.ts` registration,
  `history-state.ts` and `commands/restore.ts` reading the new line.
- Fixtures: the 0.1.1 release's own format-5 snapshots (the two
  examples and the golden cases at that tag) become the input table.
- `skills/hejbro`: the generate/verify workflow reference; the design
  spec's D101 row.
