# Design notes: add-window-functions

## The approved D104 rows

Lead-approved 2026-08-29, to be transcribed **verbatim** into
`docs/specs/2026-08-19-hejbro-design.md` by task 5.3 — both rows in one
commit, as D103 did. That file is owner-gated; this copy exists so the
approved wording is diffable rather than re-typed from a message, and so
review can check "as approved" against something.

### Summary table row (after D103)

```
| D104 | Window functions: WindowNode variant, over() wrapper, build-time placement rejection | active |
```

### Decision log row

```
| D104 | **Window functions land as a new `WindowNode` `ExprNode` VARIANT — `fn: FunctionCallNode` (narrowed, so a window inside a window is unrepresentable rather than merely rejected), `partitionBy`, `orderBy`, snapshot token `window` — never a `FunctionCallNode.over?` field: measured on the rebased branch, a field is enforced by ZERO compile errors and ZERO existing tests, and `codec.ts`'s encode/decode are closed object literals returning `JsonValue`, so a view carrying a window function would round-trip into a DIFFERENT view with nothing failing; the variant is enforced by ten mapped-type registries plus `reachable-kinds`'s `assertNever` and, one step later, the D70 completeness assertion, which stays red until a fixture actually produces one. The surface is a single `over(expr, spec)` wrapper (aggregates and window-only calls alike; declared overloads are rejected by TS2394 against the `Omit`-based brand), and the eleven window-only constructors return a `WindowFunctionCall` brand that deliberately lacks `exprNode` — `Expr` requires both fields, so a bare `rowNumber()` fails to type-check everywhere an `Expr` is expected, closing `sum(rowNumber())` as a side effect. Placement Postgres refuses is refused at BUILD time with hejbro-authored diagnostics, never left to the raw error and never attempted in the type system: `where`/`groupBy`/`having` (one rule, one code — evaluation order), an aggregate's own argument (its own code — Postgres refuses it as 42803, a different class from 42P20), and the six declaration sites that store an expression (each naming its own site and remedy, per the `check-subquery` family's shape). `distinctOn` is NOT refused — measured on postgres:17, Postgres accepts a window function there. `rowNumber`/`rank`/`denseRank` declare `bigint` through `ReadAs` AND convert to one; the five value functions take ONE signature each (splitting on a supplied default is unobservable — `ProjectedColumnResult` appends `| null` to every projected field per #307/#311 — and type information no user can read is dead surface). Frame clauses, `FILTER (WHERE …)` and named windows are out of scope; omitting a frame renders exactly Postgres's own default** (decided 2026-08-29 under the owner's standing delegation, by the lead session; D4's parking reason — "a field addition forces a v8 bump" — was void, both shapes being version-neutral, so the fork was re-decided on propagation safety alone; to be surfaced to the owner on return) | `FunctionCallNode.over?` (the parked alternative: enforced by nothing, silently dropped by the codec, and it makes "a column default with an OVER clause" type-legal since that node is shared with DDL — though so does the variant, which only makes the problem findable rather than impossible); chaining `.over()` on aggregates (would need the brand on every one of sixteen constructors instead of one wrapper); blocking placement in the type system (a phantom marker threaded through ~20 comparison and logical operators leaks silently through any user helper — a false sense of safety worse than a check); splitting `lag`/`lead` on their default argument (a dead branch today); refusing `distinctOn` for symmetry (would make hejbro stricter than Postgres) | The variant costs one explicit `convert.ts` arm the field would have inherited for free — three lines, and the free version works only by making `isBuilderAggregate`'s documented invariant false — and buys enforcement the repository had just been burned by twice: #444 fixed four hand-written traversal sites that had missed all four fields `add-offset-and-distinct` and `add-aggregates` added. Measured in-repo cost also runs the other way: a new variant leaves every existing declaration's encoding byte-identical (zero goldens, zero example chains, zero banner hash lines), where the field shape would have touched 9 of 13 goldens and 24 banner lines — or avoided them by omitting the field when absent, which is the silent-loss problem again |
```

## Why the numbers in that row are the rebased ones

The registry count was **eleven** before #444 and **ten** after: that
change folded `exists`/`selectExpr` child collection onto
`selectChildExprs`, retiring one of `walk.ts`'s maps. The row carries the
post-rebase figure because a decision log that quotes a pre-rebase
measurement is quoting something no longer true of the tree it describes.
