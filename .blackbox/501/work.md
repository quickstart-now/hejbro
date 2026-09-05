# Work — quickstart-now/hejbro#501

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — tasks 1.1-1.2: filter() and the aggregate-filter node, two file-scope gaps found by crash

_2026-09-05T13:21Z · per R1, R2, R3, R4_

Tasks 1.1 and 1.2 landed (commits ea364785, a7bd1855). Two file-scope gaps surfaced only when a test crashed, not from reviewing the file list: window.ts (over()'s runtime guard, R3) and expr-children.ts (collectColumnRefs on the render path, R4). The task split had been validated against tasks.md's own Files-edited list, never against the runtime call graph -- render-sql.ts and naming-conventions.test.ts both depend on expr-children.ts's traversal registry at runtime (a view carrying a filtered aggregate crashes rendering, not just fails a type check), and expr/window.ts's over() carries its own runtime guard separate from ast.ts's type. Both gaps were caught by running the affected suites, not by inspection, and both were escalated before being fixed rather than patched silently.

Task 1.1's own red (20 failing assertions in aggregate-filter.test.ts, "filter is not a function") was captured by reconstruction: the implementer wrote the test file and the source together, then reported that deviation, stashed packages/core/src only, re-ran the suite to recover the true pre-implementation red, and restored the stash. Recorded here as fact, not smoothed over -- task 1.2 onward captured red before any source change.

Task 1.2's own red: render-sql.test.ts (10 assertions, handler-not-a-function / undefined args), codec.test.ts (6 assertions, handler-not-a-function / missing token), expr-children.test.ts (2 assertions, undefined traversal.read) -- the last moved in from task 1.3 per R4 mid-task, red captured before expr-children.ts was touched.

Postgres 17 verification (R32): af-pg on port 55520, the exact strings vitest's renderExpr produced (no retyping) applied against a real table with mixed rows -- count(*) filter (where ...) returned 3 against an unfiltered 5, sum(...) filter (where ...) over () returned 18 against an unfiltered 119, and a create view using the same fragment round-tripped through select * correctly.

<a id="w2"></a>
## W2 — task 1.3: scope-check, retarget and cast the aggregate-filter node

_2026-09-05T13:29Z · per R2, R3, R4_

Task 1.3 landed (commit 9310bd46). retarget.ts and read-shape.ts needed no source change: retargetExprNode's generic fallback (exprChildren/replaceExprChildren) already recurses correctly through an aggregateFilter node once task 1.2 registered its two children ([fn, where]) in expr-children.ts's registry, and the accepted-set split (AGGREGATE_READ_SHAPES) task 1.1 already built into read-shape.ts covered filter()'s own needs with no further change. Both scenarios are recorded as regression pins that were green on arrival, not red-then-green cycles -- stated as fact, not smoothed into "implemented" alongside the files that did change.

walk.ts's missing scopeViolationHandlers entry was a crash (TypeError: handler is not a function), not a silent miss: a scope violation inside a filtered aggregate's condition would have thrown before this task, never silently passed undetected.

query/select.ts's cast-agreement table had an empty-green gap for sum/avg and the windowed row: "unwrap succeeded, own shape never casts" and "unwrap failed, nothing recognized as a builder aggregate" both render with no cast suffix, so a regression in the two-step unwrap (window, then aggregateFilter) would have passed those rows silently. Closed by exporting builderAggregateFunctionName (test-only, not in the public barrel) and asserting the unwrapped name directly across all five aggregates plus the windowed case -- six assertions that, once added, genuinely failed red (TypeError: builderAggregateFunctionName is not a function) before the two-step unwrap existed.

Per 412/R35 (stash banned across worktrees, a shared stash stack), the select.ts fix was set aside to capture that red without touching git stash: `git diff > select-ts.patch && git checkout -- select.ts`, ran the suite for the genuine pre-implementation failures, then `git apply select-ts.patch` to restore the fix.

<a id="w3"></a>
## W3 — task 1.4-1.5 aftermath: three registry copies and a stale barrel, all found by crash

_2026-09-05T13:46Z · per R3, R4, R5_

The proposal's own Impact list, written at 501/R1, was checked against tasks.md's own file grouping only, never against the runtime call graph or the repository's exhaustive-registry pattern -- three of the sites the new AggregateFilterNode variant forces (expr/window.ts's own runtime guard, expr-children.ts's traversal registry, and @hejbro/supabase's rls-uncached-auth-call.ts's own ChildrenOfHandlers, a third restatement of the same child-traversal shape core's own comment already names as existing outside @hejbro/core) were each found only when a test or the render path crashed, not by reading the Impact list ahead of time. The proposal is corrected (501/R5) to enumerate all four forced sites (window.ts, expr-children.ts, params.ts, the supabase validator) plus the two pins that needed no source change (retarget.ts, read-shape.ts) explicitly, closing the same kind of gap for any reviewer reading it after the fact.

The supabase validator's own fix (501/R5) followed the same red-then-green discipline as every other task in this group: two new tests (a filtered aggregate's condition, and its own function argument) were added and run BEFORE the ChildrenOfHandlers entry existed, confirming a crash (TypeError: handler is not a function), not a silent miss -- an auth.uid()/auth.jwt() call hidden inside a filter(...) condition would have thrown, never passed undetected.

A separate, unrelated gap surfaced independently while writing task 1.5's own doc snippet: packages/cli's hejbro barrel (index.ts's hand-kept value re-export list, and core-surface.ts's VOCABULARY it must match) never gained filter as a value export when core added it in task 1.1 -- `export type * from "@hejbro/core"` alone re-exported it as a type only, so `import { filter } from "hejbro"` could not call it. packages/cli/test/exports.test.ts's own barrel-curation gate (#471) had already been red since commit ea364785, unnoticed because per-package `pnpm test` runs don't cross package boundaries. Closed by adding filter to VOCABULARY, index.ts's list, and the test's own pinned HEJBRO_RUNTIME_EXPORTS snapshot (which needed the same one-line update once the barrel line was fixed).

<a id="w4"></a>
## W4 — group completion: the crap gate found a refusal-table gap in task 1.1's own code

_2026-09-05T14:16Z · per R2_

The group-completion gate (check:crap --force) found two of task 1.1's own functions over the repository's CRAP threshold of 5: aggregate.ts's describeFilterTarget (complexity 7, an if-chain over five refusal shapes -- unfixable by coverage alone, since at full coverage CRAP equals complexity) and aggregateFunctionCallOf (complexity 5, 90.9% coverage). The coverage gap was a genuine hole in the refusal table, not a false positive: an unqualified functionCall whose name isn't one of the five aggregates (e.g. lower(...)) is a computed expression the delta's own "anything that is not a builder aggregate" wording already covers, but no test exercised it. Added as a new refusal row -- green on arrival, since the refusal logic itself was already correct; the gap was the test table's, not the implementation's. describeFilterTarget's own complexity was closed by a nodeKind-keyed phrase table (FILTER_TARGET_PHRASES) plus a small describeFunctionCallTarget helper for the one dynamic case, replacing the if-chain with identical behavior -- the existing six-row refusal table plus the new row is the safety net. check:crap --force reported 0 of 1723 functions over the threshold afterward. This was this change's own defect (introduced in task 1.1, not an escalation candidate) and was closed without a lead ruling.

