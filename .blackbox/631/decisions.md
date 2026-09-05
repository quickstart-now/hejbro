# Decisions — quickstart-now/hejbro#631

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The ledger records a body checksum; migrate refuses an applied migration whose body changed; status reports it

_lead · extension · basis 412/D24, D25; #616 (the offline limit stated); the ledger identity rule's own tolerance for a fifth column; Prisma checksum / Drizzle hash precedent · 2026-09-05T05:46Z · ratified: pending_

Design (design.md Q1-Q4): SHA-256 of the body below the banner (CRLF normalized; whole file for a raised snapshot; baseline hashed too), compared over every recorded file before anything pending is sent, apply-migration-body-changed with both checksums and the restore-or-new-migration remedy; the bootstrap adds the column to an older ledger and null rows are never compared; identity stays four columns. migration-apply: four MODIFIED + one ADDED requirement. Ratification: owner on return.

<a id="r2"></a>
## R2 — the banner boundary, the normalization and the checksum's stored form

_lead · interpretation · basis R1 · 2026-09-05T16:52Z · ratified: pending_

Task 1.1's open contract details, settled by the lead under the owner's
full delegation for this pass.

**The banner boundary is two predicates, not a scan.** A migration file
carries a banner exactly when its first line -- after `\r\n` is
normalized to `\n` -- is the literal `-- hejbro migration`. The body is
everything after the first `"\n\n"`, that separator excluded. A file
whose first line is anything else carries no banner and is hashed whole
(the snapshot SQL `raise` applies). A file that is a banner and nothing
else -- no `"\n\n"` anywhere -- has the empty body, and the checksum
recorded is the SHA-256 of the empty string. Two predicates make a
falsifying input mechanical to construct, and neither moves when the
banner gains a line: `-- hejbro: <version>`, `-- baseline:`, a
change-summary line, the two hash-chain lines and `-- upgraded-from:`
(#413) all sit inside the run this rule never counts. Rejected: a
maximal leading run of `--` lines, which leaves "how many blank lines
does the separator swallow" open, so one body can hash two ways; and
"up to the `-- snapshot:` line", which has no boundary at all on a
pre-hash-chain migration, where `parseBannerHashes` answers `null`.

**Nothing but line endings is normalized.** `\r\n` becomes `\n`; a lone
`\r`, a final newline gained or lost, and trailing whitespace inside a
body are edits like any other. A checkout the platform rewrote is the
one difference a user cannot avoid; every other one is a change to the
text that ran.

**The column holds bare lowercase hex, 64 characters.** The requirement
already fixes the algorithm and the column is named `checksum`. The
banner's own `sha256:` prefix is a file format describing itself, a
different obligation. A later algorithm change earns a second column or
its own change, not a prefix carried from the start.

`bodyChecksum` lives in `apply/ledger.ts` and hashes through the
existing `sha256Hex` in `packages/cli/src/hash.ts`, which is not
modified. The bootstrap's `alter table ... add column if not exists
"checksum" text` follows its `create table` on the same
`exec(..., "write", "bootstrap")` path, so a refused upgrade is
attributed to the bootstrap like every other ledger write.

`tasks.md`'s **Files edited** header omitted `commands/migrate.ts` (task
1.3) and `apply/ledger-identity.ts` (task 1.6) and numbered the
docs/changeset task 1.6 when it is 1.7. The per-task Files lines and the
team's file boundary are correct; the header is repaired to match them.
No file boundary changes.

