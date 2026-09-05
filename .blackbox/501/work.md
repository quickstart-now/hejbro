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

<a id="w5"></a>
## W5 — review round 2 (501/R7): filter's refusal message and its condition's window guard

_2026-09-05T15:19Z · per R7_

Review round 2 (501/R7) fixed two defects the adversarial reviewer found in tasks 1.1/1.1-follow-up: B1 (describeFilterTarget named a db.fn call, a real WHEN input the delta names, as "a window function" purely because it also lacked exprNode) and B2 (filter's condition never refused a window function, though design.md and the skill reference both promised the same behavior where has -- the delta itself was silent, so the promise exceeded the spec). Fixed as two separate commits (3c917e15 B1, 2a451293 B2), per the reviewer's own request to keep the diff separable from their per-defect regression harness.

B1 went through two follow-up rounds after the first fix landed. Round one (lead direction) tried classifying any non-exprNode target lacking windowFn as "a declared function call" via a thenable check (isThenable, matching .then). The lead then corrected this: a bare Promise (db.fn's real runtime shape, packages/query/src/db/fn.ts's FnCaller) exposes no functionName/schemaName of its own, so asserting "a declared function call" for it was still naming something not actually known -- the same class of mistake the original defect was. Replaced with declaredFunctionIdentifierOf, which reads functionName/schemaName if the target exposes them and falls through to "an expression without a node" (the same phrase an arbitrary object gets) otherwise. This follow-up itself pushed describeFilterTarget's own complexity to CRAP 6 (one function covering both the non-exprNode and the exprNode-bearing cases); split into describeNonExprTarget to bring both under threshold (commit f4999077), confirmed by check:crap --force reporting 0 violations at that commit.

B2's shallow-guard requirement (window functions inside exists(...) subqueries or inside raw sql fragment text must NOT be rejected) needed no source change: assertNoWindowFunctionInCondition reuses someExprNode with the same shallow exists-is-opaque behavior query/select.ts's own assertNoWindowFunction already relies on, and sql template text is never a real ExprNode the walker could see. Two regression tests were added to pin this as fact, not left as an inference (f4999077).

Process fact: the planner edited the query-builder delta beyond the lead's stated initial approval (added the "and the target it was given" clause to the requirement's own refusal sentence) and reported it; the lead then approved the addition. Recorded as fact per the lead's own instruction.

B2's basis correction: the equivalence between filter's condition and where's own window-function refusal lived only in the skill reference and the proposal, not in the delta itself -- the user-facing contract promised more than the spec stated. That gap, together with where's actual build-time refusal for the same input, is what made this a defect; the delta now states the equivalence directly and carries its own scenario.

Six neighbor defects the same review round found, all outside this change's own scope and filed as separate issues, untouched here: #945 (snapshot decode never checks an aggregate-filter node's own call identity, only that fn/where are present -- a corrupted call name silently re-renders), #947 (applyColumnOrderToViewQuery throws a bare TypeError on a defineView thunk, reaching a user who skipped type-checking via the jiti load path), #948 (defineFunction's args-prototype-key guard misfires on a bare array, blaming a missing __proto__), #949 (isColumnBuilder crashes via `in` on a string returns value), #950 (ctx.return(literal(1))'s diagnostic doesn't say literal() is boolean-only), #951 (inArray(column, <subselect>) throws a bare "values.map is not a function").

<a id="w6"></a>
## W6 — review round 3 (501/R8): naming a thenable target honestly

_2026-09-05T15:42Z · per R7, R8_

Review round 3 (501/R8): the reviewer's own request to prove the db.fn refusal row against the real public path (not a synthetic stand-in) surfaced a further inaccuracy the identifier-lookup approach (R7 B1 follow-up) still had -- a real handle.fn.*(...) call exposes no functionName/schemaName of its own (confirmed directly: Object.keys() on the real Promise is empty), so the identifier-lookup path always fell through to the generic phrase for the real input, making the lookup itself dead code for the one case it was built for. Replaced with a direct thenable check: a thenable is named "a thenable, not an expression -- a function called through db.fn is one" (states the fact, points at the most common cause); anything else without exprNode is "a value without an expression node". Naming the function exactly needs a brand core defines and db.fn's own thenable stamps -- filed as a follow-up, #953 (under #815), out of this change's file boundary (packages/query/db/** is bt's).

packages/query/test/db/fn.test.ts now asserts filter()'s exact message against a REAL db(schema, driver) handle's own handle.fn.countPosts({}) call (not core's bare-Promise stand-in), closing the gap the reviewer named directly: a message previously proven only against a hand-built shape, never the real public path it claims to describe.

<a id="w7"></a>
## W7 — R8 addendum and review round 3 closure: thenable boundary pins, snapshot stability, crap timeout

_2026-09-05T16:12Z · per R7, R8_

R8 addendum (the tool has no append; recorded here and cross-referenced against R8, not a rewrite of it): the identifier branch is removed -- no public constructor produces a value carrying functionName/schemaName without an exprNode, and this piece already met a branch kept green by synthetic inputs only (B1). Exact naming is #953. The dispatch is now three-way: exprNode, then thenable, then "a value without an expression node".

The lead's boundary-row request (four rows: `{ then: 1 }`, `Promise.resolve(1)`, `{ then: () => {} }`, `{}`) was checked directly: all four were green on arrival, confirming the R8 dispatch's own boundary rather than finding a new defect. They landed as regression pins (commit 032ab600) with no source change.

Review round 3's own harness ran 28/28, the refusal table was unchanged, and the snapshot hash matched round 1 and round 2 exactly -- the fix changed no generated output.

check:crap --force's first failure was a 5000ms timeout in cross-instance-symbols, not a real regression: four isolated retries passed 4/4. The cause was load (bt and rn's worktrees running concurrently), not this change's own code; the lead connected it to #920 as a data point, not a reopening of #839 and not a defect of this change.

Neighbor issue numbers from this review's own findings: #945, #947, #948, #949, #950, #951, #953, #954.

<a id="w8"></a>
## W8 — Correction: the crap-gate flake measurement is 1 failure in 6 runs

_2026-09-05T16:21Z · per R7, R8_

Correction to W7's flake measurement (the tool has no edit; recorded as a new entry, not a rewrite of W7). W7 stated only "four isolated retries passed 4/4." Review round 4's own full gate sweep reran `check:crap --force` a second time under the same conditions and it passed, giving a complete count:

Measured 1 failure in 6 runs: the first full gate sweep failed while bt and rn worktrees ran concurrently, four isolated retries passed, and a second full sweep under the same conditions passed as well -- load-dependent, not caused by this change (data point for #920).

The prior W7 phrase "isolated retries passed 4/4" undercounted by omitting the second full-sweep pass; this entry supersedes it for that number.

