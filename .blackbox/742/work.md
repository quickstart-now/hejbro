# Work — quickstart-now/hejbro#742

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Argument-key corpus and the overlapping-column join view

_2026-09-05T08:55Z_

contract-emit.test.ts: five argument keys through the real emitter; the metadata fragment loads with the key intact and the `Args` type line carries it JSON-quoted when not an identifier. examples/postgres step 10: `task_projects` selects `tasks.id`/`projects.id` under one join; generated SQL qualifies every projected column (`"app"."tasks"."id" as "task_id"`, …); chain test walks ten steps, built-CLI count 10, round trip green.

