# Work — quickstart-now/hejbro#501

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — tasks 1.1-1.2: filter() and the aggregate-filter node, two file-scope gaps found by crash

_2026-09-05T13:21Z · per R1, R2, R3, R4_

Tasks 1.1 and 1.2 landed (commits ea364785, a7bd1855). Two file-scope gaps surfaced only when a test crashed, not from reviewing the file list: window.ts (over()'s runtime guard, R3) and expr-children.ts (collectColumnRefs on the render path, R4). The task split had been validated against tasks.md's own Files-edited list, never against the runtime call graph -- render-sql.ts and naming-conventions.test.ts both depend on expr-children.ts's traversal registry at runtime (a view carrying a filtered aggregate crashes rendering, not just fails a type check), and expr/window.ts's over() carries its own runtime guard separate from ast.ts's type. Both gaps were caught by running the affected suites, not by inspection, and both were escalated before being fixed rather than patched silently.

Task 1.1's own red (20 failing assertions in aggregate-filter.test.ts, "filter is not a function") was captured by reconstruction: the implementer wrote the test file and the source together, then reported that deviation, stashed packages/core/src only, re-ran the suite to recover the true pre-implementation red, and restored the stash. Recorded here as fact, not smoothed over -- task 1.2 onward captured red before any source change.

Task 1.2's own red: render-sql.test.ts (10 assertions, handler-not-a-function / undefined args), codec.test.ts (6 assertions, handler-not-a-function / missing token), expr-children.test.ts (2 assertions, undefined traversal.read) -- the last moved in from task 1.3 per R4 mid-task, red captured before expr-children.ts was touched.

Postgres 17 verification (R32): af-pg on port 55520, the exact strings vitest's renderExpr produced (no retyping) applied against a real table with mixed rows -- count(*) filter (where ...) returned 3 against an unfiltered 5, sum(...) filter (where ...) over () returned 18 against an unfiltered 119, and a create view using the same fragment round-tripped through select * correctly.

