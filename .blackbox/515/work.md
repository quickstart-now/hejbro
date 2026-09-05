# Work — quickstart-now/hejbro#515

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the four sites fold onto core's exported traversal and guards

_2026-09-05T19:46Z_

The four sites outside core fold onto its exported interface. Core now exports `exprChildren`, `replaceExprChildren`, `requireNext`, `requirePrevious` and `requireBoth` as engine surface, pinned three ways: a new `packages/core/test/exports.test.ts` proving each resolves through the package entry as a live binding, `hejbro`'s classification test listing all five as engine, and one `@ts-expect-error` value use per name for the barrel's compile-time absence. The `hejbro` classification test was the second stage of a deliberate two-stage red: it went red naming exactly the five unclassified names once `index.ts` exported them.

The parameter lifter (`packages/query/src/compile/params.ts`) lost 11 per-kind lift functions and its 16-row handler table (-279/+32 lines); `liftExprNode` keeps three branches by design -- `literal` (the node itself becomes the placeholder), `exists`/`selectExpr` (descend into the `SelectNode`), and everything else through `exprChildren`/`replaceExprChildren`. The proof is a 21-row input table (`packages/query/test/compile/params.test.ts`): every node kind the registry knows with a distinct literal in every child position, plus four flag-carrying rows and one nested row, hand-derived from each kind's render order and pinned against the pre-fold code at `31689711`, then rerun unchanged after the fold. Two falsifying mutations measured what the table catches: dropping the last child before the rebuild reddened 14 rows; reversing the children reddened 11. Every row that stayed green has 0 or 1 children or uses a dedicated branch.

The Supabase RLS validator lost `ChildrenOfHandlers` and its 16-kind table. Its `exists`/`selectExpr` descent stays as its own two branches: core's `exprChildren` treats a subquery as opaque on purpose, so a bare substitution would have silently stopped finding an `auth.uid()` inside `exists(...)`. A 31-row table (one row per node kind and child position with an `auth.uid()` in each, plus three contrast rows carrying none) was pinned pre-fold and rerun after; removing the descent branches reddened those two rows and four pre-existing exists tests.

The two inline `invalid-kind-change` guards (`packages/supabase/src/storage/bucket-kind.ts`, `examples/preset-smoke/src/preset.ts`) became `requireNext`/`requirePrevious`. Their refusals now name the change by its kind token (`supabase-storage-bucket`, `smoke-schema-note`) the way core's own kinds do; two existing message pins moved to that wording and three new pins were added. Gates at close: `TURBO_FORCE=1 check-types` 19/19; `check:bans` ok; query suite 1125 tests; supabase 181; preset-smoke 5.

