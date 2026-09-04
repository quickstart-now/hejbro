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

