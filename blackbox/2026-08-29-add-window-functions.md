Refs:
- .changeset/add-window-functions.md @ blob 9b7a5f240bfbe7b650bd52f7fdca768c7e19b4df
- docs/specs/2026-08-19-hejbro-design.md @ blob de65640e1d4219c1b952ee06bbbaeaed6710c25a
- openspec/changes/add-window-functions/design.md @ blob 381fcc6561b9e47645270eca2862352115c4fd1d
- openspec/changes/add-window-functions/proposal.md @ blob 7564a65f6d597ff009d0fc014f853dcf938af196
- openspec/changes/add-window-functions/specs/query-builder/spec.md @ blob 84de6f68b22c9a88e2d2cb5282e99bce69a34a15
- openspec/changes/add-window-functions/specs/query-type-inference/spec.md @ blob 9a8e4295c2ec8363e0dc7f3b51cc47202de8bf81
- openspec/changes/add-window-functions/specs/table-declaration/spec.md @ blob f0747ad4e72519fef070124f3c203c2ce31262cc
- openspec/changes/add-window-functions/tasks.md @ blob a2b25354fe8c9292151e331d4082661d00850ae3
- openspec/task-times.csv @ blob ded105d6c76c2e4d3730cb4c424ac416c3c2c12c
- packages/cli/test/exports.test.ts @ blob b881476c9b53ac54ce48bf7004dcbafda00044e5
- packages/core/src/dsl/rls.ts @ blob 9f9dd5902b53209f32c121b8395519394bc242f1
- packages/core/src/dsl/table.ts @ blob a5209625c17e984cbccfd696d7d4a34453249e06
- packages/core/src/expr/aggregate.ts @ blob 8f36cd62a97d9308430a3f04358cafeb194fc38c
- packages/core/src/expr/ast.ts @ blob 26007f38a0acb2826e957cf6049e72e4820e4fa1
- packages/core/src/expr/codec.ts @ blob 25df12d986b89535b490101ba87eab6ffe5783b2
- packages/core/src/expr/render-sql.ts @ blob 79c99b9d33bde8d93df680734e86dc5d0610b9ca
- packages/core/src/expr/retarget.ts @ blob c49767f9eb64648421a6a9ea0d14611d097a807e
- packages/core/src/expr/walk.ts @ blob fe2e062d5e9608f450a22a576f3ffc402fa2a24d
- packages/core/src/expr/window.ts @ blob 0ffda71c70ac3dc4fe7d183e537e9b7a65de65dc
- packages/core/src/index.ts @ blob 7fe6ddbab994d77e0f54275464efc57dd53ceb26
- packages/core/src/query/select.ts @ blob 1f9440696fa97499229c5d1740c01e568a1dbb77
- packages/core/test/dsl/check.test.ts @ blob ebcfb0443440ee392d1f421281e8e2f24c5ec601
- packages/core/test/dsl/window-declaration.test.ts @ blob fea77ad1eedaf22340ba69faf98194042449b2d2
- packages/core/test/expr/codec.test.ts @ blob 2b569c209d830cb768d165120ca63c4c595c7864
- packages/core/test/expr/reachable-kinds.ts @ blob 9429cfcb0083e4e75fe863b7f4e7fc703b3d07a6
- packages/core/test/expr/retarget.test.ts @ blob 3e7292b5bf7127dddbd0900eb08813acf459f9ab
- packages/core/test/expr/walk.test.ts @ blob 674be89969421d78f049993f84e01c3b77916d72
- packages/core/test/expr/window-node.test.ts @ blob 4f6e583c9e3cffa01dd987c74a1668abd3c55429
- packages/core/test/naming-conventions.test.ts @ blob c852b841b7393e1797efd3e7913395abd1c343f1
- packages/core/test/query/window-placement.test.ts @ blob 5058008881382d2d02fb05ceb007f78f5e8aeb5c
- packages/core/test/query/window.test.ts @ blob 651bbd31469dcb89db67a089009b18c7cdfef7cd
- packages/core/test/view-kind.test.ts @ blob e260c91cd5c43d42b748a0c640937117674fecdb
- packages/pg/test/integration.test.ts @ blob 5ffc13499f6b468ee73d7d79a949feea820b086e
- packages/query/src/compile/params.ts @ blob 592d42bfea20ca5929e7f0d51d1faf4d032a43ce
- packages/query/src/db/convert.ts @ blob 027d6ecf0980766cc58b2c639687b8a941902362
- packages/query/test/compile/window.test.ts @ blob 4b7c4887974a42240dc0bc8d978b03acc624ab12
- packages/query/test/db/window.test.ts @ blob a982878fe6b1901da0d1e461d7c5f454fdde9318
- packages/query/test/types/window.test.ts @ blob 132a23b84140edb12dfd062fd83a6aaef9116e65
- packages/supabase/src/validators/rls-uncached-auth-call.ts @ blob 0b82c881a3edd3151fc0717e6c5bf649c03c9480
- packages/supabase/test/rls-cached-auth-outside-rls.test.ts @ blob eda9867333de54f580db7c8cce1e6f8997386310
- packages/supabase/test/rls-uncached-auth-call.test.ts @ blob 68e74735d94171d60038b171369728976e718099
- README.md @ blob 787dd4b52cb7c0df4d9183a66befb7eda10b4846
- skills/hejbro/references/query-layer.md @ blob bd1c6ab5e2c1572f87583ef4c498091efb6d9c1e

# add-window-functions — WindowNode, over(), and the D4 fork settled as D104 (#416)

Team piece (planner + implementer, reviewer relayed through the
planner), worktree `window-functions` off dev `0bd6bf6`. `add-aggregates`
had already shipped the aggregate half of #416 and parked the window IR
choice as D4 ("whether a window is its own node or a field on the
function call"); this piece resolves D4 into D104 and builds the surface
on top of it.

## Owner context

Owner delegation (2026-08-29, verbatim, Korean): "다시 자리 비워야하니까
이제 머지던 기획 결정사항이던 전부 너가 ORM을 만든다는 기준으로 결정하고
기존절차대로 처리해줘. … 너랑 내가 만들고 있는 이게 ORM이라는것, 오로지
Postgres, Postgres기반으로 만들어진 서비스를 위한 ORM이라는거 명심하고
처리해줄래? 기존 절차대로 팀이 필요하면 팀으로 처리도 하고, openspec에서
오너결정사항 필요해도 내가 올때까지 너가 직접 결정하고."

Return rule (owner, same day): mid-session owner messages do not end the
delegation; only an explicit return declaration does. All owner-gated
decisions in this change (D4's resolution into WindowNode + `over()`,
D104's addition to the decision log, and F1's scope — the six declaration
sites that reject a window function) were made by the lead session under
this delegation, to be surfaced to the owner on return.

## What was built and why

`WindowNode` lands as a new `ExprNode` variant, not a
`FunctionCallNode.over?` field — D104's own decision-log row (transcribed
in this PR, `docs/specs/2026-08-19-hejbro-design.md`) states the measured
reasons in full: a field is enforced by zero compile errors and zero
tests, while the variant is enforced by ten `ExprNode["nodeKind"]`-keyed
registries plus `reachable-kinds`'s `assertNever` and the D70 completeness
assertion. One `over(target, spec)` wrapper covers both an existing
aggregate and one of eleven new window-only constructors
(`rowNumber`/`rank`/`denseRank`/`percentRank`/`cumeDist`/`ntile`/`lag`/
`lead`/`firstValue`/`lastValue`/`nthValue`); the window-only constructors
return a `WindowFunctionCall` brand that deliberately omits `exprNode`
(required by `Expr`), so a bare call fails to type-check anywhere an
`Expr` is expected — closing `sum(rowNumber())` as a side effect rather
than a special case. Placement Postgres itself refuses is refused at
build time with hejbro-authored diagnostics: `where`/`groupBy`/`having`,
an aggregate's own argument, and six declaration sites that store an
expression (a column default, a generated column, an index expression or
predicate, a check constraint, an RLS policy) — each exercising the
owner-gate axis under the delegation above, since none of these six sites
were open questions the proposal could resolve without an owner-level
call on how wide the rejection surface should be.

## What went wrong

1. **The planner gave two instructions without reading the code first,
   and both were wrong in ways that would have broken the change if
   followed.**

   **Error A — routed the deep-walker proof through a validator that
   scopes policies out.** The planner's task 1.7 instruction: prove
   `someDeepExprNode`'s window arm by hiding a cached `auth.uid()`
   (`(select auth.uid())`) inside `over()`'s `partitionBy` in a
   **policy's** `using`/`with check`, checked by
   `rls-cached-auth-outside-rls`. That validator scopes RLS
   `using`/`with check` out **on purpose** (a cached call is legitimate
   there — documented at `rls-cached-auth-outside-rls.ts:155-166`), so
   the instructed path could never prove anything. Worse, the column
   default the implementer chose instead was not an alternative site but
   the *only* reachable one: `check` and an index predicate both hit
   core's own subquery guard first, which hard-errors before the
   validator is ever reached. The implementer read the validator's own
   source, switched to the column-default path, and reported the
   deviation instead of silently complying or silently following a test
   that could never go red. The reviewer independently confirmed both
   the scope-exclusion and the hard-error ordering and ruled the
   implementer's judgment correct over the instruction; task 1.7's
   wording was corrected to record that the default is the sole
   reachable site, and why the other two are not.

   **Error B — instructed stripping `family` from the brand as well as
   `exprNode`.** The planner's task 2.1 instruction: the
   `WindowFunctionCall` brand should lack both `family` and `exprNode` so
   a bare window-only call cannot be used as an `Expr`. Wrong on two
   independent grounds: `family` is not a phantom marker but real runtime
   data — `expr/operators.ts`'s comparison operators read `.family` at
   runtime to lift the other operand — so removing it would have broken
   operand lifting; and it was unnecessary regardless, since `Expr`
   requires *both* `family` and `exprNode` (`ast.ts:338`), so omitting
   `exprNode` alone already blocks the assignment structurally. The
   implementer kept `family`, dropped only `exprNode`, and reported the
   deviation. The planner read `ast.ts:338` directly, confirmed the
   implementer's reasoning, and corrected task 2.1's wording to record
   both grounds. The reviewer later confirmed with a four-site leak probe
   (a `sql` tag, `numeric().default()`, `jsonb().default()`, and the
   value functions) that keeping `family` never leaks it anywhere it
   shouldn't reach.

   **The common shape**: both instructions were written without reading
   the file each one governed, and both were corrected only because the
   implementer read the code, declined to comply as-instructed, and
   reported before proceeding rather than after. Had either instruction
   been followed as written, A would have left an unfalsifiable test in
   place and B would have broken a real runtime code path. This is the
   same failure shape as the three narrow-task-wording instances and the
   rebase false alarm below: the side holding the plan, not the file,
   wrote the sentence that turned out wrong.

2. **D104's own cost claim was measured in a direction that flattered its
   conclusion, and review caught it.** An early draft of the decision-log
   argument for the variant (over the field) asserted the field
   alternative would make "a column default with an OVER clause"
   silently type-legal in a way the variant structurally could not.
   Review found this overstated the asymmetry — the variant only makes
   the mistake *findable* (a runtime/build-time guard), not
   *impossible*, since nothing in the type system stops either shape from
   being placed in a default's expression tree. The wording was
   re-measured and corrected before the row was finalized, rather than
   left standing on the more favorable-sounding claim.

3. **Group 1's own walk-arm coverage landed at zero — the exact trap this
   change exists to document, one registry over from where the team was
   looking.** Task 1.5 proved `retarget.ts`'s window arm actually
   descends (not just compiles) via a positive test. Review found both of
   `walk.ts`'s handler maps (`someExprNodeHandlers`/
   `someDeepExprNodeHandlers` sharing `SomeExprNodeHandlers`, and
   `scopeViolationHandlers`) had no equivalent proof — deleting their
   window arms left the whole suite green. This change's own premise
   (#444: a registry forces a handler to *exist*, never that it
   *descends*) applied to its own new arms in the same piece that landed
   them, not just to the pre-existing ones #444 was filed to fix.

4. **`tasks.md`'s own wording was narrower than the work actually
   required, three times**, each caught only once the task was underway
   rather than corrected up front:
   - **Task 1.5** originally scoped its descent proof to `retarget.ts`
     alone; item 3 above is what widened the requirement to both
     `walk.ts` maps as task 1.7.
   - **Task 4.2's bigint set** started naming only `count` as needing a
     `bigint` conversion; the actual requirement (Postgres's own
     `row_number`/`rank`/`dense_rank` all returning `int8`, same as
     `count`) meant three more names had to share the same conversion
     branch, and the branch's own name (`COUNT_STATE`) stopped being
     accurate once it did — renamed to `BIGINT_STATE` mid-task rather
     than left describing only its first member.
   - **Task 4.2's value functions** started with only `lag` covered by a
     conversion assertion; `lead`/`firstValue`/`lastValue`/`nthValue`
     were added to `PASSTHROUGH_AGGREGATES` in the same edit but without
     their own assertions, so deleting four of five names from the list
     left the suite green. Each of the five now carries its own
     assertion, verified by mutation (removing any one name turns
     exactly that assertion red).

5. **A rebase false alarm — wrong diagnosis, zero cost, because the
   response was freeze-first.** Mid final-rebase, the planner read
   working-tree files that were mid-replay and concluded groups 2-4's
   artifacts (design.md, tasks.md's checkboxes, convert.ts's contents)
   had been lost, and instructed the implementer to stop, not run any
   rebase command, and report read-only status. The rebase had, in fact,
   already completed successfully in an earlier step of the same turn —
   the planner was reading a stale snapshot, not a real loss. `git
   status` (clean), `git rev-parse HEAD` (the expected post-rebase SHA),
   and direct inspection of the supposedly-missing files all confirmed
   nothing was lost. The diagnosis was wrong; the outcome cost nothing,
   because the standing instruction under uncertainty was to freeze and
   forbid destructive operations rather than to guess-and-fix. Separately
   and more importantly, the same incident surfaced that
   `upstream/feat-window-functions` had never actually been pushed — every
   rebased commit existed only in the local object store with no remote
   backup — closed immediately by pushing and verifying with `git
   ls-remote`. The standing correction from this: check the ref and the
   object store, not only the working-tree files, before diagnosing loss;
   and push to `upstream` after every group's review passes (not only at
   the end), capping exposure at one group's worth of work.

6. **`openspec/task-times.csv` carries zero rows for this change's groups
   1-4, and the judgment process that followed is itself worth recording
   over silently patching the gap.** The planner never asked for
   per-task actual-minute figures as each group's review passed —
   `AGENTS.md`'s own rule ("durations land in task-times.csv when a group
   completes") was not enforced along the way. Discovered only at task
   5.2, when filling the ledger was attempted retroactively. Two ways of
   closing the gap were considered and both rejected before either
   touched the file: copying each task's `est_min` into `actual_min`
   would force the estimate multiplier to exactly `1.00` — manufacturing
   the owner's own convergence target as data, worse than an honest miss;
   leaving `actual_min` blank does not fall through the ledger neutrally
   either, since `scripts/tasktime-badges.mjs`'s `parseMinutes` reads an
   empty field as `0`, which would count the row as "estimated" while
   contributing zero actual time, dragging the average and the multiplier
   down (looking artificially fast) — a different-direction distortion of
   the same metric. Reconstructing every task's actual time from memory
   was rejected too, as a large-scale plausible fabrication; omitting the
   whole group wholesale was also rejected, since it would discard real,
   currently-fresh knowledge of the in-progress group 5 tasks along with
   the genuinely-unknown ones. The lead's ruling, obtained before writing
   a single row: omit only what cannot be defended right now (a
   task-times row for group 1-4 makes no claim at all, which is neutral
   to the multiplier, unlike a fabricated or zeroed one); include only
   what passes a defend-it-now test (can this task's pure work minutes be
   stated and stood behind in this conversation, not derived from commit
   timestamps, which mix in review-wait and coordination time under a
   different unit than `actual_min`); flag every included figure
   `reconstructed`; and record the omission itself, and this judgment
   process, here rather than just leaving the ledger quietly thin. This
   is the sixth item in this list on purpose: withholding a plausible
   number is a discipline the same size as fixing a wrong one, and a
   flight recorder that only lists corrected mistakes would miss the one
   that was never made.

7. **The 5.2 documentation itself shipped a wrong claim under a "verified
   live" badge, on the very axis this change spent five groups
   insisting be checked rather than asserted.** The skill's window-
   functions section said `lastValue`/`nthValue` "both" return the
   current row's value under the default frame and called that
   "verified live against postgres:17" — but the live witness (task
   5.1) only ever exercised `lastValue`. Review caught both halves of
   the problem at once: the claim about `nthValue` is false (measured on
   postgres:17, `nth_value(x, n)` returns `null` until the frame grows to
   contain `n` rows, then freezes at row `n`'s value for every later row
   in the partition — it does not track the current row the way
   `lastValue` does), and the "verified live" badge was already attached
   before any witness covered it. A claim carrying a measured-live badge
   without the measurement behind it is worse than an unbadged guess,
   because it reads as checked when it never was — exactly the failure
   mode item 2 above describes for a cost claim, recurring one level
   later in the same change's own documentation. Fixed both halves
   together: corrected the sentence to state the two functions'
   genuinely different behavior, and added an `nthValue(amount, 2)`
   projection to the same live test, load-bearing-verified by asserting
   the old (wrong, current-row-tracking) prediction first — confirmed to
   fail against real postgres:17 with the exact values the false claim
   would have predicted — then reverting to the correct, now-witnessed
   sequence.

## What went right

The final rebase's gates were judged against **"does this still pass
after #456's fix"**, not **"does this still pass"** — a different
question, and the one that mattered. #456 was deliberately bidirectional
(its own commit message says so): alongside fixing a false failure in an
existing check, it also closed a hole where a `Next:` sitting inside a
comment (not a real diagnostic clause) could satisfy the check without
being one. This change's nine new error codes passing under the
stricter, post-#456 parser is a different fact from having passed under
the pre-#456 one — the framing this piece used is exactly what a later
rebase should reuse: verify against what the tree's gates require *now*,
not against what they required when the task was written.

## Gates

`pnpm check` (biome) clean · `pnpm check-types` 13/13 packages clean ·
`pnpm test` — core 82 files / 1114 passed + 1 todo, query 44 files / 650
passed, supabase 15 files / 114 passed, pg (unit) 1 file / 24 passed, all
clean · `pnpm --filter @hejbro/pg test:integration` 14/14 against a real
postgres:17 (Docker) — the one new test load-bearing-checked by
temporarily dropping `row_number` from `convert.ts`'s `BIGINT_FUNCTIONS`,
observing the `rn` bigint assertion fail with the exact wrong (string)
values, then reverting and re-confirming green · `pnpm check:bans` clean
(no `let`/`var`/loop statements) · `pnpm check:next-marker` /
`pnpm check:diagnostic-xref` clean · `pnpm check:crap` 0/1416 functions
over CRAP 5 (README unchanged — numbers already matched). One
`.changeset` (`minor`, `@hejbro/core`, fixed group moves all five
packages).
