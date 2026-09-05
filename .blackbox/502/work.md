# Work — quickstart-now/hejbro#502

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 18 server-behaviour claims measured on PostgreSQL 17.11: none wrong

_2026-09-05T09:13Z_

Scripts `claims.sql`, `c11.sql` and the raw output `claims.out` sit beside this file. Population: the issue's grep, 30 lines, 12 of which state hejbro's behaviour under a database refusal rather than a claim about the server. Every claim held; two notes (inet '42.5' example is loose; PG17 SET EXPRESSION AS exists, the spec's "universal grammar" hedge covers it). Table posted on the issue.

