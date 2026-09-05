# Work — quickstart-now/hejbro#486

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — W1 -- mutation testing closes the task 1.3 red-first gap (486/R10)

_2026-09-05T12:00Z · per R10_

Four mutations against `packages/query/src/db/context.ts`, each applied, run through `TURBO_FORCE=1 pnpm --filter @hejbro/query test`, then reverted (never committed):

| Mutation | Tests turned red |
|---|---|
| Flip the path-selection guard in `scopedRun` (`if (driver.capabilities["interactive-transactions"])` -> its negation) | 27 tests, including all four new task-1.3 tests that exercise `db.as(...)` (`context.test.ts`'s "interactive true ... batch is never called", "interactive false, batched true: batch runs exactly once ...", "invariant: the batch path's send executes exactly one statement", "interactive false, batched true: db.fn also runs through the batch path") and the identity test below |
| Skip `contextStatements` inside `runContextInBatch` (batch only the caller's own statement) | 4 tests: `context.test.ts`'s "interactive false, batched true: batch runs exactly once ...", "the same statements ... travel through both paths", "... db.fn also runs through the batch path", and `context-provider.test.ts`'s "interactive false, batched true: batch runs exactly once ..." |
| Force `capabilitiesForOperation` to always return the two-key array (its `operation === TRANSACTION_OPERATION` branch replaced with `if (false)`) | 1 test: `context-provider.test.ts`'s "batched-only: a provider handle's own db.transaction still asserts only interactive-transactions" |
| Make `lastBatchRows` take the first array member instead of the last | 1 test: `context.test.ts`'s "interactive false, batched true: batch runs exactly once ..." (its "resolving to the last member's rows" assertion) |

The first mutation, run before the identity test was strengthened, initially left one test green: "the same statements, from the same rendering, in the same order travel through both paths" compared two `undefined` slices to each other (both sides' recording arrays stayed empty because the mutation sent both drivers through the same, wrong branch), so the equality check passed vacuously. Fixed by adding explicit call-count/length assertions on each side before the equality comparison (`packages/query/test/db/context.test.ts`, committed separately as `d3bf3766`). Re-running the same mutation afterward turned that test red along with the rest (27 total). All four mutations were re-run once more after that fix, confirmed still red, then reverted; `git diff --stat packages/query/src/db/context.ts` was empty and the full suite returned to 1048 passed after each revert.

<a id="w2"></a>
## W2 — task 1.2b rewrote #557's boundary test -- before and after titles, per 486/R12

_2026-09-05T13:53Z · per R12_

Task 1.2b (#486) rewrote the boundary test #557 added, since the driver it guards now declares a real `batched-transactions` capability (per 486/R12). Both titles, in full, from the commit that changed them (`e110a078`, `packages/neon/test/driver.test.ts`):

Before (task 4.3, #557):
> `buildHttpDriver + db.as(context) still refused with missing-capability (task 4.3, #557 -- the boundary this change must not move: a context-rendering contribution point existing on the contract does not widen who may run a context)`

After (task 1.2b, #486):
> `buildHttpDriver + db.as(context) now runs as one batch (task 1.2b, #486 -- #557/D95's boundary was drawn for a mere contribution point on a driver declaring no relevant capability; this driver now declares batched-transactions:true, the capability that specific boundary predates)`

The nested `it` title changed with it: from "db.as(context) on the HTTP driver fails with the same missing-capability error it failed with before, and never sends a request" to "db.as(context) on the HTTP driver succeeds, sending the context statements and the caller's own statement as one batch, in order". #557's own proposition (a contribution point alone does not widen a capability) is unchanged and unaffected -- only this specific driver's capability declaration changed, which is what the rewritten title states.

<a id="w3"></a>
## W3 — task 1.4's file pointer was wrong; the artifacts corrected it (486/R13)

_2026-09-05T14:19Z · per R13_

Task 1.4 pointed at a capability table in `query-layer.md` that does not exist; the literal table is in `supabase-preset.md`. Following the task text alone would have updated nothing and missed the real defect: `query-layer.md`'s RLS section still said a context fails without `interactive-transactions`, which this change had already made false. The task's wording was corrected to the artifacts as they are (486/R13).

<a id="w4"></a>
## W4 — the review's scale and N3's routing history (486/R14)

_2026-09-05T15:05Z · per R14_

A constructor-mode review ran against the range `8b6258c5..c8ca0b1d`: ~76 lines of constructed input, 10 type obligations, 101 real-server transactions exercised, and all 12 gates green. It returned no blocking finding and four non-blocking ones (N1-N4, 486/R14). N3 -- a batched-only driver returning the wrong number of row lists is never checked, so a contract-breaking driver could hand a context statement's own rows to the caller as if they were the caller's -- was first routed to a separate issue (#946, under #815) as a defensive check outside this delta's stated scope, then pulled back into this same PR on the planner's fail-closed argument and closed here instead, per R14's own addendum.

<a id="w5"></a>
## W5 — result-rows.ts's R6 and context.ts's R14 are separate zero-result decisions

_2026-09-05T15:06Z · per R6, R14_

Two zero-result sites in this change look alike but are not the same decision. `packages/query/src/driver/result-rows.ts`'s `lastRows` (task 1.6, #892) folds a single node-postgres multi-command result array to its last member's rows; a zero-length array there is unreachable (measured against postgres:17, 486/R6) and keeps its own uncoded internal-invariant `Error`, unchanged by this work. `packages/query/src/db/context.ts`'s `lastBatchRowsChecked` (task 1.3, #486/R14) checks a driver's own `batch` result against the number of members the query layer sent; a zero-count result there is a real, driver-reachable contract violation (a broken third-party driver, not an internal bug), and now resolves through the coded `batch-result-count-mismatch` alongside the fewer/more cases, replacing its own former uncoded internal-invariant `Error`. The two functions share no code and answer different questions -- one about a single driver library's own result shape, the other about a driver author's own contract compliance -- so R6 and R14 stand independently; neither revises the other.

