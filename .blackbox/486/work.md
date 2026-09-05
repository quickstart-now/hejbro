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

