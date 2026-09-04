# Work — quickstart-now/hejbro#748

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-core-derivations 1.1: plpgsql-declared variables and missing reserved keywords refused

_2026-09-04T13:25Z_

Change `harden-core-derivations`, group 1, task 1.1 (commit 3ac91650 on branch `fix-core-derivations`).

`packages/core/src/plpgsql/reserved.ts` gains 21 names: the 15 variables plpgsql declares itself (`found`, `sqlstate`, `sqlerrm`, and the twelve `tg_*` trigger variables) and the 6 fully reserved SQL keywords the list was missing (`analyse`, `analyze`, `current_catalog`, `except`, `lateral`, `system_user`). `assertValidLocalName` compares the lower-cased name, so a loop name spelled `FOUND` is refused the way Postgres would fold it. The message now says the name collides with a name plpgsql reserves — a keyword, or a variable plpgsql declares itself — under the unchanged code `reserved-local-name` and the unchanged `Next: rename it.`

Measured: red first — `define-function.test.ts` (21 refused derived names as an input table, 6 accepted look-alikes) and `body-context.test.ts` (loop names `found`/`FOUND`/`Found`/`tg_op`/`TG_OP` refused, a row named `found` accepted) — 28 failed / 73 passed; green after the list and the fold — 101 passed. Two existing `/reserved word/` regexes updated to the new prose, behaviour unchanged. Pure work ~7 min against an 8 min estimate (implementer-stamped).

Scope kept by ruling: type-and-function-name keywords (`left`, `join`, `is`, …) were not added without a measurement; `tg_*` names are refused uniformly in every function.

