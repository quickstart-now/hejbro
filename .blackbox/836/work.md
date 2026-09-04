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

