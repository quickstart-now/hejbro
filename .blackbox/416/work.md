# Work — quickstart-now/hejbro#416

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-window-functions — WindowNode, over(), and the D4 fork settled as D104 (#416)

_2026-08-29T00:00Z_

Team piece (planner + implementer, reviewer relayed through the
planner), worktree `window-functions` off dev `0bd6bf6`. `add-aggregates`
had already shipped the aggregate half of #416 and parked the window IR
choice as D4 ("whether a window is its own node or a field on the
function call"); this piece resolves D4 into D104 and builds the surface
on top of it.

### What was built and why

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

### What went wrong

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

### What went right

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

### Gates

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

Migrated from the single-file entry `.blackbox/2026-08-29-add-window-functions.md`, kept verbatim at `.blackbox/416/artifacts/2026-08-29-add-window-functions.md`.

