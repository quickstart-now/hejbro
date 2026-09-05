# Work — quickstart-now/hejbro#823

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — group 1: a ledger write failure is the ledger's, never the migration's

_2026-09-04T22:29Z · per R1_

execute.ts's catch now reads the tag first and rethrows a tagged failure
untouched, so apply-failed is the else branch and keeps naming migration
files only. migrate renders the ledger's own diagnostic with the ledger as
its identity, never the filename, and answers two rather than one: a
ledger failure is the one case that proves the database refused no
migration. The body still names the file it was recording, which is what
was being written; the header is what may not. Measured: a ledger whose id
carries neither identity nor default fails the insert with 23502 and rolls
the whole migration back, and the objects that migration declares are
absent afterwards. reset's clearing of the ledger moved off
reset-drop-failed for every refusal, not only the 42501 the task named:
the tag is by statement, not by SQLSTATE, so the 55000 and 42P01 TOCTOU
rows #753 pinned there moved with it — a ledger write that found no ledger
is not a failed drop. The rollback is still surfaced, never swallowed,
which was that decision's own point.

<a id="w2"></a>
## W2 — group 2: attribution holds when the ledger vanishes mid-transaction

_2026-09-05T00:42Z · per R4, R6_

The in-transaction recheck was swallowing Postgres's own 42P01 as "not
recorded", so a ledger dropped while migrate held its transaction turned
into 25P02 on the migration's own statement and was billed to that file
with exit one — both halves of this issue's rule breaking at once. The
leniency is gone from that recheck; readLedger keeps its own, because
outside a transaction an absent ledger is still the state "hejbro has
never applied here" (D9). Which code the escaped failure takes is settled
by the statement, not by the operation in progress (836/R6, correcting
R4): the recheck is a read, so a ledger that vanishes before it answers
is apply-ledger-unreadable, while one that vanishes before the row is
written is apply-ledger-unwritable. Both exit two, both roll back, both
name the ledger. The witness reproduces the race in its real order:
hold migrate's advisory lock from psql, poll pg_locks until the run is
demonstrably waiting, drop the ledger, release the lock.

