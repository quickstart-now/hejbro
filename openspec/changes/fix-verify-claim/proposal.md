# Proposal: fix-verify-claim (#616)

## Why

The shipped `cli-commands` requirement for `verify` promises that "a
hand-edited migration … is reported as a mismatch naming the artifact".
Measured against the shipped code, that is true of a migration's banner
lines and false of its SQL body: the two banner hashes are snapshot
hashes (`migration-format` says so; `migration-apply` now says outright
that the chain "never" vouches for "a file's own SQL bytes"), and no
check re-hashes a body. An edit that alters a statement and leaves the
banner alone passes `verify` unreported. The corpus therefore carries
one sentence that claims an integrity property the product does not
have, next to two that say it does not — the class of defect the D106
gate exists to catch, found here by the add-apply-engine round while it
was correcting the sibling sentence.

`docs/guide/renames.md` repeats the overclaim in stronger words ("the
chain's `parent-snapshot`/`snapshot` lines are hashes over file
contents"), so the guide is corrected in the same change.

## What Changes

- The `verify` requirement states what its hashes cover — the recorded
  sequence of declared states, checked link by link from the first
  hashed file — and states every limit the D106 review measured: a body
  edit that keeps the two hash lines passes, so does an edit to any
  other banner line, a rename that keeps sort position, and the removal
  of the first migration (the chain root's `parent-snapshot:` is taken
  as given, by core's design for legacy-prefix chains). The hand-edit
  scenario narrows its WHEN to the two hash lines and the snapshot; two
  scenarios pin the passes. No behaviour changes.
- Subprocess tests pin the stated limits (body edit, non-hash banner
  line, first-file removal — each `verify` exits 0). They arrive green —
  they are pins on contract sentences; the day a body hash or a root
  check ships is the day they are meant to turn red on purpose.
- `docs/guide/renames.md` says what the banner lines actually hash.
- One `patch` changeset: a documented contract of the released CLI is
  corrected.

Building body integrity — Prisma's and Drizzle's answer is a checksum
recorded in the ledger at apply time, not an offline check — is a
separate feature, filed under the Phase 10 tray rather than folded in
here: it adds a column to a durable object and a refusal path to
`migrate`, and deserves its own proposal.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-commands` — the requirement "The migration chain on disk is
  verifiable": the SHALL names what the chain vouches for, the
  hand-edit scenario narrows to the two hash lines and the snapshot, and
  scenarios pin each measured limit (body edit, first-file removal,
  position-keeping rename, an added hash-less file).
- `migration-apply` — the requirement "Applying refuses a chain that
  does not verify, and reports what disagrees": `migrate` walks the same
  chain, so its sentence and scenario take the same two root qualifiers
  (the first migration's `parent-snapshot:` is taken as given; removing
  the first migration passes the pre-flight), and a scenario states it.
  Round 2 of the D106 review measured `migrate` opening its connection in
  exactly those two cases.

## Impact

- `openspec/specs/cli-commands/spec.md` and
  `openspec/specs/migration-apply/spec.md` (via this delta),
  `packages/cli/test/verify.test.ts` (one test), `docs/guide/renames.md`
  (one sentence), `.changeset/*.md`, `openspec/task-times.csv`.
- No source file changes. `verify`'s output, exit codes and diagnostics
  are untouched.

## Out of scope

- Hashing migration bodies, offline or in the ledger (tray issue, filed
  with this change).
- The `chain-tip-mismatch` and `broken-chain` diagnostic texts, which
  already speak of the banner lines and the snapshot.
