# Work — quickstart-now/hejbro#817

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-function-locals 1.3: loop and row names take the hejbro SQL-name rule

_2026-09-05T10:18Z_

Change `harden-function-locals`, group 1, task 1.3 (commit c6deccf1 on branch `harden-function-locals`).

A `ctx.forEach` loop's record name and a `ctx.row`/`ctx.rowOrNull` read's own name now go through `assertSqlName` (D36), the same rule an argument key's derived name already meets, instead of reaching the render step unquoted and unchecked. The check order, settled mid-task (832/R5, then R6): reserved (case-folded) before SQL-name before duplicate for a rendered name (loop, row-derived scalar); SQL-name before duplicate for a row read's own name, which is never reserved-checked (its own name renders nowhere). A loop named `FOUND` still answers `reserved-local-name` (case-folded reserved wins first); a loop named `Row` also answers `reserved-local-name` now that `row` is itself a category-C reserved word (1.2), while a row read named `Row` -- which takes no reserved check -- answers `invalid-sql-name` instead, the contrast a dedicated test pins.

Measured: red first -- invalid-spelling table (hyphen, upper-case, leading digit, space, empty, non-ASCII) for both loop and row names against `invalid-sql-name`; `row_a` then `Row_a` failing on the second (`invalid-sql-name`, never `duplicate-local-name` -- #821 dies on this path since a hejbro SQL name is lower-case by definition and two case-different spellings can never both pass); loop/row-read pairs sharing one name failing `duplicate-local-name` naming both constructs by kind. Green: `RecordingState.declaredNames` split into `renderedNames`/`constructNames` maps; `table.ts`'s `duplicate-column` also updated in this task to name both colliding keys and the shared name, mirroring `duplicate-argument`. Full `pnpm test` green afterward, no collateral. Pure work ~15 min against a 10 min estimate (implementer-stamped) -- the check-order tripwire (raised, then settled by the lead) accounts for the overrun.

