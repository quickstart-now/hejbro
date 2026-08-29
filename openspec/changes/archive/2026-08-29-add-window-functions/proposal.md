# Proposal: add-window-functions

## Why

`add-aggregates` shipped the half of #416 that is table stakes and said
where the rest went:

> Window functions (`over(...)`) are the other half and stay there: they
> carry a parked IR decision (whether a window is its own node or a field
> on the function call) that is worth settling on its own, and nothing
> about aggregates depends on it.

This change settles that decision (D4, resolved below as D104) and builds
the surface on top of it. Without it, a running total, a per-group rank,
or "the previous row's value" has no expression in the builder at all —
the escape hatch produces `Expr<"unknown">`, and `row_number()` arrives as
the string `"1"`.

## What Changes

- **One new expression node**: `WindowNode` — an `ExprNode` variant
  (`fn: FunctionCallNode`, `partitionBy`, `orderBy`), snapshot token
  `window`. `fn` is narrowed to a function call, not a general
  expression: Postgres requires the windowed thing to *be* a function
  call, and the narrowing makes "a window function inside a window
  function" unrepresentable rather than merely rejected.
- **The window vocabulary**: `rowNumber`, `rank`, `denseRank`,
  `percentRank`, `cumeDist`, `ntile`, `lag`, `lead`, `firstValue`,
  `lastValue`, `nthValue`, rendered as Postgres's own function names.
- **`over(expr, spec)`** — one wrapper covering both inputs: an existing
  aggregate (`over(sum(t.amount), …)`) and a window-only call
  (`over(rowNumber(), …)`). `spec` carries `partitionBy` and `orderBy`.
- **Window-only calls are not `Expr`.** The eleven constructors above
  return a `WindowFunctionCall` brand that deliberately lacks the
  `family`/`exprNode` shape every `Expr` position requires, so forgetting
  `over()` fails to type-check everywhere an `Expr` is expected. Postgres
  rejects every one of them without an `OVER` clause; the type says the
  same thing.
- **Placement Postgres rejects is rejected at build time.** `where()`,
  `groupBy()` and `having()` refuse an argument containing a window
  function, with a hejbro-authored diagnostic naming the clause and the
  evaluation-order reason. So does an aggregate's own argument, and so do
  the six declaration sites that store an expression (column defaults,
  generated columns, `check` constraints, index expressions and
  predicates, policy expressions) — otherwise the declaration
  type-checks, the migration is generated and committed, and the failure
  appears only when that file is applied.
- **Result types matched by conversion.** `rowNumber`/`rank`/`denseRank`
  declare `bigint` through the existing `ReadAs<T>` brand *and* convert to
  one; a windowed aggregate keeps the aggregate's own mapping.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-builder`: the window vocabulary, the `over()` wrapper, the
  emitted SQL, and the build-time placement rejection.
- `query-type-inference`: what a projected window function reads back as,
  and the rule that a window-only call is not an expression until wrapped.
- `table-declaration`: the declaration sites that store an expression
  refuse a window function, as they already refuse a subquery.

## Impact

- **Affected code**: `packages/core` (`expr/ast.ts`,
  `expr/render-sql.ts`, `expr/codec.ts`, `expr/walk.ts`,
  `expr/retarget.ts`, a new `expr/window.ts`, `query/select.ts`,
  the declaration guards under `dsl/`,
  `index.ts`), `packages/query` (`compile/params.ts`, `db/convert.ts`,
  `types/select-result.ts`), `packages/supabase`
  (`validators/rls-uncached-auth-call.ts`), `packages/pg` integration
  witness, `skills/hejbro`.
- **Breaking**: none — additive throughout.
- **Snapshot**: format 8 extended in place, no bump. Measured: this shape
  leaves every existing declaration's serialization **byte-identical**
  (see below).
- **Decision log**: adds D104 (the D4 resolution).
- **Depends on**: #444 (`fix-select-traversal`). This change rebases onto
  it and reuses its traversal helper rather than adding hand-written
  traversal sites — see "Traversal discipline".

## D104: why a node, not a field on the function call

D4 parked the fork with the reason "a field addition forces a v8 bump".
That reason is void — v8 is unreleased and `add-aggregates` already
extended it in place. The fork was re-decided on propagation safety,
measured on this worktree.

**A field would be enforced by nothing.** With `over?` on
`FunctionCallNode`, every consumer keeps compiling while ignoring the
expressions inside the clause. Measured across the nine defenses that
exist: the number of compile errors is **0** and the number of existing
tests that turn red is **0**. Two consequences stand out:

- `codec.ts`'s `encodeFunctionCall`/`decodeFunctionCallNode` are closed
  object literals returning `JsonValue`. Omitting `over` is not a type
  error, so a view carrying a window function would **round-trip into a
  different view** — silent corruption of this project's own artifact.
- `FunctionCallNode` is shared with DDL: column defaults, `check`
  constraints, index expressions and predicates, generated columns and
  RLS policies all build one, and Postgres rejects a window function in
  every one of them (measured: `42P20`, e.g. `window functions are not
  allowed in DEFAULT expressions`). **Neither shape makes those uses
  ill-typed** — every one of those sites takes an expression, so a
  windowed one is assignable either way. What differs is whether the
  problem is *reachable*: with a node, one `nodeKind` test finds a window
  anywhere, and the DDL-facing validators are compiler-forced to say what
  they do with it; with a field, finding one means remembering to look at
  a field nothing forces anyone to look at. (This bullet first claimed the
  field shape *made* those uses type-legal, which was wrong in the way
  that flatters the conclusion; review caught it and the claim was
  re-measured. The DDL sites are closed by this change on their own merits
  — see "What Changes" — not as a by-product of the node.)

That "enforced by nothing" is a statement about the defenses that exist,
not a permanent one: #444 lands a `keyof` ratchet over `SelectNode`, and
the same device aimed at `FunctionCallNode` would close most of the
traversal gap. It would not close the codec's closed object literals
without being aimed there too, and — this is the point — it is a ratchet
**the field shape would have to build**, not one it inherits. The three
findings below survive it regardless, because they are not about
traversal.

**A node is enforced by ten compile errors** — the mapped-type handler
registries over `ExprNode["nodeKind"]` in `render-sql.ts` (×2),
`codec.ts` (×3, counting `NODE_KIND_TO_SNAPSHOT`), `walk.ts` (×2),
`retarget.ts`, `params.ts` and `rls-uncached-auth-call.ts` — plus the
`assertNever` switch in `reachable-kinds.ts` and, one step later, the D70
completeness assertion, which stays red until a fixture *actually
produces* a window function in a serialized declaration. (Measured at
eleven before #444; that change folded `exists`/`selectExpr` child
collection onto `selectChildExprs`, retiring one of `walk.ts`'s
registries. Re-measured on the rebased branch rather than carried
forward.)

**This failure mode is not hypothetical.** `add-offset-and-distinct` and
`add-aggregates` added four fields to `SelectNode`, and four hand-written
traversal sites missed all of them — including `having`'s literals not
being bound as parameters. Those are #444, being fixed in parallel. A
field on `FunctionCallNode` would be the same bet a third time.

**What the node costs, honestly.**

- `convert.ts` needs one explicit arm delegating to `expr.fn`
  (≈3 lines). Without it a windowed `count()` would convert *worse* than a
  plain `count()`. A field would have inherited that conversion for free
  — the node's only measured disadvantage. The free version is also an
  accident: it works by making `isBuilderAggregate`'s documented
  invariant ("true only for the builder's own unqualified aggregates")
  false. The delegation is deliberate instead.
- The eleven registries force a handler to be *written*; they do not force
  it to *descend*. `window: (node) => node` compiles, and
  `retarget.test.ts`'s reference-identity loop passes without descending.
  The descent check there is a hand-written list. Tasks 1.5 and 4.2 exist
  because of this and must not be dropped.

**What the node saves that was not expected.** `encodeSelectNode` emits
its fields unconditionally, which is why `add-aggregates` paid a golden
regeneration. A new `ExprNode` variant changes no existing declaration's
encoding: goldens **0**, example snapshots **0**, migration banner hash
lines **0**. The field shape would have touched 9 of 13 goldens, both
example chains and 24 banner hash lines — or avoided them by omitting the
field when absent, which is the silent-loss problem again.

## Traversal discipline

`WindowNode` carries child expression arrays. Adding a hand-written
traversal site for them would repeat #444's defect a fifth time. Every
site this change touches is an existing exhaustive registry; where #444's
`selectChildExprs` helper and its `keyof` ratchet apply, this change goes
through them rather than around them.

## Why placement is checked at build time, not in the type system

Window functions are rejected in `where()`/`groupBy()`/`having()` at build
time, with a hejbro-authored diagnostic (code
`window-function-not-allowed`) stating the evaluation-order reason and a
remedy — never left to the raw Postgres error, and never attempted as a
compile-time type constraint. The two are different in kind: `having`'s
stage-locked availability after `groupBy()` (add-aggregates) works because
it gates on *which chain stage the caller holds*, representable as method
presence on an interface; window-function placement is a constraint on
*arbitrary content nested inside an already-built `Expr` value*, the same
class of problem `foreign-column-ref` already solves at build time rather
than in the type system — no `Expr` in this DSL carries enough
compile-time structure to say what its own subtree contains, and
retrofitting that (a phantom marker threaded through every logical and
comparison operator) would leak silently across any user-defined helper
function, giving a false sense of safety worse than an explicit check.

The rejection covers exactly three clauses. `distinctOn` is **not** among
them: measured on postgres:17, `select distinct on (row_number() over ())
…` is accepted, because `distinct on` counts as part of the select list.
Rejecting it would make hejbro stricter than Postgres.

The one constructor-level exception is the reverse nesting: an aggregate
whose argument contains a window function is rejected too, matching
Postgres's own separate error for it (`42803`, `aggregate function calls
cannot contain window function calls`).

## Why window-only calls are not expressions

Unlike the placement rule, this one is local to a single constructor's own
return value, and closing it costs exactly one purpose-built type rather
than a marker threaded codebase-wide. A bare `rowNumber()` fails to
type-check everywhere an `Expr` is expected, mirroring Postgres's hard
requirement that each of these needs an `OVER` clause, and it closes the
nesting case as a side effect: `sum(rowNumber())` does not compile.

If the brand turns out to degrade inference or error messages in practice,
the fallback is a build-time `window-function-requires-over` check with
the same message; taking the fallback is reported with its reason rather
than decided silently.

## The value functions take one signature, not two

Postgres returns null from `lag`/`lead` at a partition's edge unless a
default is supplied, and from `firstValue`/`lastValue`/`nthValue` when the
frame holds no such row. The honest-looking move is to split the
signatures so that supplying a default narrows the result back to
non-null. This change does **not** do that, for a measured reason:
`ProjectedColumnResult` appends `| null` to every projected field on all
three of its branches, deliberately (#307/#311 — a projection's type is
fixed before `.leftJoin()` can widen it). There is no channel through
which the distinction could reach a result type, so a split signature
would be a dead branch: more surface, no observable difference. Opening
that channel means changing an owner-gated decision, which is out of this
change's scope. Type information no user can read is dead surface, and
this repository removes dead surface rather than keeping it in hope —
`isBaselineMigration` went for the same reason.

All five value functions therefore share one rule — pass the operand's
type through, unchanged, with no signature split on `default` or frame
position. This composes with #444's F9 (the operand's origin brand is
preserved rather than its whole shape) without interacting: the origin
brand decides *which* type a field inherits, `| null` is appended to the
result either way.

**Handoff**: when #307 closes, revisit whether `lag`/`lead` with a default
should narrow. The correctness is real; only its observability is missing
today.

## Out of scope

- **Frame clauses** (`ROWS`/`RANGE`/`GROUPS`). Omitting the clause is not
  a gap: Postgres's default with an `ORDER BY` is `RANGE BETWEEN UNBOUNDED
  PRECEDING AND CURRENT ROW`, which is exactly what rendering nothing
  produces. `WindowSpec` takes an optional `frame` later without touching
  a single existing call site. Two consequences are recorded rather than
  hidden: `lastValue`/`nthValue` are of limited use under the default
  frame (Postgres's own documentation calls the result unhelpful), and a
  frame offset modeled as an `ExprNode` will need an `exprLiftHandlers`
  arm or its literals will be inlined into SQL text — the exact shape of
  #444's `having` defect.
- **`FILTER (WHERE …)`** — legal only on aggregate window functions, its
  own grammar addition.
- **Named windows** (`WINDOW w AS (…)`, `OVER w`) — a second binding
  mechanism, not needed to express anything above.
- **Filtering on a window result** — that needs a subquery or CTE, which
  is #417.
