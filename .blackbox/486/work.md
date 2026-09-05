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

