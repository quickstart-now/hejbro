# Work — quickstart-now/hejbro#836

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — group 1: ledger reads, and the bootstrap write, are coded rather than raw

_2026-09-04T22:29Z · per R1, R2_

ledger.ts's own exec tags every statement it sends with a direction and a
site, keeping the server's error as cause; apply/ledger-diagnostics.ts
turns a tagged read into apply-ledger-unreadable, naming the ledger, the
role and the server's own code and message, and ending with a Next: line.
The role is read with select current_user on the failure path only, and
always outside the failed transaction: measured on postgres:17-alpine, a
statement sent on an aborted transaction is refused 25P02, so classifying
inside the callback would lose the role clause in exactly the case the
issue is about. A fake driver that throws if transaction() is called pins
that. Scope followed the rule rather than the issue's wording (836/R2):
migrate under a role without create fails first at its own bootstrap
create schema (measured), which is a ledger write and is coded as one.
The identity probe's own catalog read is coded too. Live witness on
postgres:17-alpine: status, raise and migrate against a privilege-starved
role print a coded diagnostic with no stack frame, and migrate exits two.

<a id="w2"></a>
## W2 — group 2: review repairs — the reads, the probe, and the driver that killed the process

_2026-09-05T00:41Z · per R3, R4, R5, R6_

Constructor-mode review of 1351d507 returned four blocking findings, all
of them the code disagreeing with the delta. migrate now reads the ledger
before it bootstraps one, the order raise already used: a ledger that
exists but cannot be read was answering "the ledger's own bootstrap",
because create ... if not exists checks the ACL before existence, so
which code a database got depended on which grant happened to be
missing. The identity probe's own catalog read was already coded in
group 1 and stays so. @hejbro/pg's pool had no error listener, so a
connection lost mid-read killed the process before any catch could run;
the scope widened to that package by lead ruling (836/R4, R5) and this
work closes #864. Two listeners were needed, not one, and the plan said
one: the pool's own event covers idle clients, while a checked-out client
raises its own, so a per-checkout listener joins it. The reviewer's
reproduction also turned out not to be the code-less path it was assumed
to be: the server answers the waiting query with 57P01 first, and the
crash came from a second, duplicate client error event after the socket
closed. Both corrections were measured, not reasoned, and the task
document was rewritten to say what the server does.

