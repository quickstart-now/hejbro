# Proposal: add-ledger-checksum (#631, #865)

## Why

`verify` cannot see a hand-edited migration body: the banner's two
hashes are snapshot hashes, so an edit below the banner passes the
offline walk, and the requirement says so. The question "was the SQL
that ran the SQL that is checked in?" can only be answered by something
that saw the SQL run — the ledger. Prisma stores a `checksum` per
applied migration and warns on a modified one; Drizzle stores a `hash`
and refuses on mismatch. hejbro's ledger records the filename and the
origin, and nothing about the body. Nothing is published on a stable
line yet, so the column is cheap today; after 0.2.0 it is a change
hejbro must make to its own table.

A neighbour on the same table (#865): with row-level security forced on
`"hejbro"."migration_ledger"` and a policy hiding its rows from the
connecting role, `status` reads an empty ledger without complaint and
the next `migrate` re-applies the chain from the start, failing at
`42P06`. The ledger lies instead of refusing.

## What Changes

- **The ledger records a body checksum.** A fifth column, `checksum`,
  holds the SHA-256 of the migration's body — the text below the banner
  block, line endings normalized to `\n` — for a migration that was
  applied or registered, and of the whole file for one that was raised
  (a snapshot SQL file carries no banner). The bootstrap creates the
  column and adds it to a ledger written before it existed; the ledger's
  identity stays the four columns it has always required, so an older
  ledger is still the ledger.
- **`migrate` refuses an applied migration whose body changed.** Before
  applying anything pending, every recorded file present on disk is
  hashed and compared; a mismatch is `apply-migration-body-changed`,
  naming the file, the two checksums and the remedy — restore the file
  from version control; hejbro never rewrites applied history. A row
  recorded before the column existed carries no checksum and is not
  compared.
- **`status` reports a changed body as its own line**, exiting non-zero
  like every other disagreement, never as "applied".
- **A ledger whose rows are filtered for this role is refused.** The
  identity judgement reads `relrowsecurity`/`relforcerowsecurity` on
  the ledger relation; a ledger with row-level security enabled is not
  one hejbro created, and every ledger-touching command refuses with
  `apply-ledger-filtered`, naming the ledger, the role and the policies
  found, with a `Next:` (disable row-level security on the ledger, or
  connect as the role that applied). A ledger hejbro can read
  unfiltered is unaffected.
- The generate/verify workflow reference states which half answers
  which question; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`migration-apply`** — MODIFIED requirements: *Migrations are
  applied in chain order, and what was applied is recorded* (the
  column; identity unchanged), *A migration is applied atomically with
  its own ledger row* (the row carries the checksum), *A baseline is
  registered rather than run* (the checksum is recorded as registered),
  *What the ledger holds can be read without applying anything* (the
  changed-body line). ADDED requirement: *An applied migration whose
  body changed is refused*.

## Impact

- `hejbro` (CLI): `apply/ledger.ts` (bootstrap, row shape, read),
  `apply/execute.ts` (compare before apply, record on apply),
  `apply/raise.ts`, `commands/status.ts`, `commands/migrate.ts`
  diagnostics; the live witnesses in `packages/cli/test/*.integration.test.ts`.
- `skills/hejbro`: `references/generate-verify-workflow.md`.
