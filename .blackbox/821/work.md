# Work — quickstart-now/hejbro#821

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-function-locals 1.3: Row/row dies on the SQL-name rule, case-folding the duplicate check is unnecessary

_2026-09-05T10:18Z_

Change `harden-function-locals`, group 1, task 1.3 (commits c6deccf1, d1b719d1 on branch `harden-function-locals`).

The design ruling (Q2) resolves #821 without adding case-folding to `duplicate-local-name` itself: a hejbro SQL name is lower-case snake_case by definition (D36), so once a row read's own name is checked against that rule (`assertSqlName`, this task's own addition for #817), two spellings that fold to one Postgres identifier -- `row_a` and `Row_a` -- can never both reach the duplicate check. The upper-case spelling is refused first with `invalid-sql-name`, never `duplicate-local-name`; the two rows in question render `duplicate declaration at or near "row_id"` on the server before this task, and are refused at declaration time after it.

Measured: red first -- `row_a` then `Row_a` asserted to fail with `invalid-sql-name`, not `duplicate-local-name`. A companion contrast test (commit d1b719d1, added after the check-order ruling settled) pins the asymmetry between the two name spaces on the identical spelling `Row`: as a loop name (reserved-checked) it fails `reserved-local-name` (`row` is a category-C reserved word since 1.2); as a row read's own name (never reserved-checked) it fails `invalid-sql-name` instead -- the two rules never both claim one name. Full `pnpm test` green afterward. Pure work counted under 1.3's combined 15 min (implementer-stamped, not split separately).

