# Work — quickstart-now/hejbro#818

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-function-locals 1.3: duplicate-column names both colliding keys

_2026-09-05T10:18Z_

Change `harden-function-locals`, group 1, task 1.3 (commit c6deccf1 on branch `harden-function-locals`).

`buildColumnEntries`'s `duplicate-column` refusal (`packages/core/src/dsl/table.ts`) now names both colliding TypeScript keys and their shared derived SQL name, in the same order `duplicate-argument` already uses -- previously it named only the derived name after snake-casing. A new `findDuplicateColumnName` helper mirrors `define-function.ts`'s `findDuplicateArgName` (first key whose derived name repeats an earlier key's, reported alongside that earlier key). `findDuplicateArgName`'s own doc comment, which said a column's message names only the shared name, is corrected in the same commit since it is now false.

Measured: red first -- `table-surface.test.ts` gains an input table (`userId`/`user_id` both declaration orders, a four-key two-pair case) asserting the message contains the table name and both keys; the pre-existing generic duplicate-column test, which matched on the old prose, is re-pinned to the `duplicate-column` code instead of a message substring. Green after the helper and the new message. Full `pnpm test` green afterward. Pure work counted under 1.3's combined 15 min (implementer-stamped, not split separately).

