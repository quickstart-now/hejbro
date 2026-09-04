# Work — quickstart-now/hejbro#751

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-core-derivations 1.2: duplicate-argument for keys deriving to one SQL name

_2026-09-04T13:25Z_

Change `harden-core-derivations`, group 1, task 1.2 (commit 77c94a3c on branch `fix-core-derivations`).

`packages/core/src/dsl/define-function.ts`: after the per-key refusals (`invalid-sql-name`, then `reserved-local-name`, in declaration order), `resolveArgs` runs `assertNoDuplicateArgName` over the whole resolved list and refuses the first pair in declaration order whose keys derive to one SQL name with `duplicate-argument`, naming the function, both keys and the shared name — the same placement `buildColumnEntries`' `duplicate-column` check has for a table.

Measured: red first — input table `{userId,user_id}`, `{user_id,userId}`, `{v2Id,v2_id}`, `{aB,a_b}`, `{userId_,user_id_}`, `{userId,userID,user_id}` (message asserted to name `userId`, `user_id` and the shared `user_id`); controls `{postID,postId}` → `post_i_d`/`post_id` and `{id,id_}` → `id`/`id_` accepted; precedence rows `{order,userId,user_id}` → `reserved-local-name` and `{"my-arg",userId,user_id}` → `invalid-sql-name` — 6 failed / 70 passed; green — 76 passed. Pure work ~2 min against a 7 min estimate (implementer-stamped).

`duplicate-column`'s own message (derived name only) is left as is; unifying it is #818.

