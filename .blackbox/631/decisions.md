# Decisions — quickstart-now/hejbro#631

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The ledger records a body checksum; migrate refuses an applied migration whose body changed; status reports it

_lead · extension · basis 412/D24, D25; #616 (the offline limit stated); the ledger identity rule's own tolerance for a fifth column; Prisma checksum / Drizzle hash precedent · 2026-09-05T05:46Z · ratified: pending_

Design (design.md Q1-Q4): SHA-256 of the body below the banner (CRLF normalized; whole file for a raised snapshot; baseline hashed too), compared over every recorded file before anything pending is sent, apply-migration-body-changed with both checksums and the restore-or-new-migration remedy; the bootstrap adds the column to an older ledger and null rows are never compared; identity stays four columns. migration-apply: four MODIFIED + one ADDED requirement. Ratification: owner on return.

