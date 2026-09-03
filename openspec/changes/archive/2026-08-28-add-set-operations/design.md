# Design: add-set-operations

## Settled decisions (owner brainstorm 2026-08-28, D103)

1. **#299 decomposes into three changes** — set-ops → window+aggregates
   (#416, ALL aggregates including `groupBy`/`having` per the owner's
   D7 ruling) → CTEs (#417). Smallest node surface first; each later
   change settles its own parked fork (window IR form; the CTE
   from-source fork) over landed terrain. The recon that sized this
   was independently re-verified claim-by-claim before the brainstorm.
2. **`SetOpNode` is a new `QueryNode` variant**, never a `SelectNode`
   field: recursive `left`/`right` branches express nesting, the
   whole-set `orderBy`/`limit` placement matches SQL, and — decisive —
   every statement-node map is a mapped type over the union, so a new
   VARIANT is compiler-forced at all seven sites while a new FIELD is
   silently dropped by seven of them (the codec's fixed key literal,
   the renderer's clause list, retarget equality, walk child
   extraction, the lifter, column-order, view serialize).
3. **Set-ops are view-body legal** with the codec completed: a new
   discriminator is vocabulary (D73 — no `formatVersion` bump, the
   `selectExpr` precedent); `projectionColumns` and the D81
   column-order oracle resolve via the LEFT branch.
4. **Branch compatibility is type-enforced** (mismatched keys =
   compile error), result = left keys, per-key type union,
   nullability OR — the STRICT family rule: what the database will
   certainly reject must not compile.
5. **Aggregates ride the window change in full** (owner's D7 call,
   against the smaller-cut recommendation): #416 carries window
   functions AND plain `groupBy`/`having` — its proposal budgets the
   `SelectNode`-field silent-drop axis explicitly.

## Shape

### The node

```
SetOpNode {
  queryKind: "setOp"            // kebab "set-op" in the snapshot
  operator: "union" | "intersect" | "except"
  all: boolean
  left: SelectNode | SetOpNode
  right: SelectNode | SetOpNode
  orderBy: ReadonlyArray<OrderByTerm>   // whole-set
  limit: number | null                  // whole-set
}
```

`QueryNode` grows the variant; the seven statement-node sites
(renderer handlers, query compile handlers, `decodeSelectNode`'s
guard neighborhood — a set-op needs its own decode entry —
`encodeSelectNode`'s sibling, `columnPlanForStatement`,
`CompileInput`/`unwrapQueryNode`, plpgsql `returnQuery`) all fail to
compile until handled. plpgsql's `returnQuery` renders it like any
query; no plpgsql surface work.

### Rendering

`renderSetOp`: render each branch (parenthesized when itself a
set-op — associativity stays explicit), join with the operator
keyword (+ ` all`), then whole-set `order by`/`limit`. CORRECTED at
group 4 against the real server: Postgres resolves set-op `order by`
against the OUTPUT column list and REJECTS qualified references there
— so the renderer emits bare output column names, and the guard is
membership in the leftmost select's output list (`invalid-set-op-order`
otherwise; a non-column term is rejected the same way — the honest v1
subset, the `sql` hatch covers positional/alias forms).

### Builder and chain

Core: the six combinators join the `SelectLimited` base stage (both
branches accepted as any select stage or prior combination), returning
a new `SetOpStage` carrying `orderBy(...)`/`limit(...)` — a fourth,
short ladder, mirrored in the query chain with the usual thenable
terminal. The result-typing utility lives in
`packages/query/src/types/` beside `relations.ts`.

### Types

`SetOpResult<Left, Right>`: `[keyof Left] extends [keyof Right]`
(mutually) gates compatibility — on mismatch the combinator's
parameter is `never`-poisoned exactly like `related()`'s excess-key
rejection; on match, `{ [K in keyof Left]: Left[K] | Right[K] }`
(identical types collapse by idempotence; `| null` arrives via either
branch's own nullability).

### Views

`defineView` accepts the set-op stage; `view-kind.serialize` encodes
via a queryKind dispatch; `projectionColumns(setOp)` recurses into
`left` (and the D81 oracle likewise). Round-trip pinned by a golden.

## What this change does NOT touch

- `formatVersion` stays 7 (vocabulary rule, D73).
- No `groupBy`/`having`/window/CTE — #416/#417's own cycles.
- `JoinKind`, `ProjectionNode`, `ExprNode` — untouched; set-ops are
  statement-level only.

## Risks

- The whole-set `orderBy` accepts only left-branch OUTPUT columns by
  name — stricter than Postgres (which also accepts positional
  references) — honest subset, documented in the skill; the `sql`
  hatch covers the rest (D93).
- `decodeSelectNode`'s callers that REQUIRE a plain select (plpgsql
  select-into, the column-order oracle's table case) keep their
  narrow expectations — each gets an explicit loud rejection rather
  than a silent mis-read where a set-op cannot appear.
