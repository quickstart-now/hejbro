# Work — quickstart-now/hejbro#748

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-core-derivations 1.1: plpgsql-declared variables and missing reserved keywords refused

_2026-09-04T13:25Z_

Change `harden-core-derivations`, group 1, task 1.1 (commit 3ac91650 on branch `fix-core-derivations`).

`packages/core/src/plpgsql/reserved.ts` gains 21 names: the 15 variables plpgsql declares itself (`found`, `sqlstate`, `sqlerrm`, and the twelve `tg_*` trigger variables) and the 6 fully reserved SQL keywords the list was missing (`analyse`, `analyze`, `current_catalog`, `except`, `lateral`, `system_user`). `assertValidLocalName` compares the lower-cased name, so a loop name spelled `FOUND` is refused the way Postgres would fold it. The message now says the name collides with a name plpgsql reserves — a keyword, or a variable plpgsql declares itself — under the unchanged code `reserved-local-name` and the unchanged `Next: rename it.`

Measured: red first — `define-function.test.ts` (21 refused derived names as an input table, 6 accepted look-alikes) and `body-context.test.ts` (loop names `found`/`FOUND`/`Found`/`tg_op`/`TG_OP` refused, a row named `found` accepted) — 28 failed / 73 passed; green after the list and the fold — 101 passed. Two existing `/reserved word/` regexes updated to the new prose, behaviour unchanged. Pure work ~7 min against an 8 min estimate (implementer-stamped).

Scope kept by ruling: type-and-function-name keywords (`left`, `join`, `is`, …) were not added without a measurement; `tg_*` names are refused uniformly in every function.

<a id="w2"></a>
## W2 — harden-core-derivations 2.1: category-T keywords refused after the review measurement

_2026-09-04T13:59Z_

Change `harden-core-derivations`, piece-review round, task 2.1 (branch `fix-core-derivations`).

The spec-bound reviewer measured every `pg_get_keywords()` category-T keyword on PostgreSQL 17.11 as a rendered plpgsql local: 22 of 23 fail at `CREATE FUNCTION` with a syntax error (`raise exception 'value %', left;` → `syntax error at end of input`); `current_schema` reads as a local. The requirement's owned-name sentence already covered the class; the list did not. Under R4 as refined by the lead ("refuse the measured breakage only"), the 22 measured keywords are added to `reservedPlpgsqlNames` and refused with the unchanged `reserved-local-name`; `current_schema` stays accepted and is the control row.

Two delta sentences were tightened in the same round, no code behind them: the row-name control now states the projection condition (`tg` over `{ id }` accepted, over `{ op }` refused for the local `tg_op`), and the reported duplicate pair is defined as the first key whose derived name repeats an earlier key's, reported with that earlier key (`{ aB, xY, x_y, a_b }` → `xY`/`x_y`).

Measured: red first — 22 refused derived names as an input table plus the `current_schema` control, the two row-name control rows, the four-key pair row; green after the 22 list entries. Pure work minutes in the ledger (implementer-stamped).

