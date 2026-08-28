# Design: add-relational-reads

## Settled decisions (owner brainstorm, 2026-08-28 — seven rounds)

1. **Two-layer structure.** The base is explicit correlated-subquery
   expressions; the sugar derives the same subqueries from foreign
   keys. Both compile to identical SQL and both expose it via
   `compile()`. This is D92's "optional layer on top, never the base"
   made literal: the sugar is definitionally a shorthand for a base
   form the user can always write out.
2. **Base helpers are `jsonArrayFrom` / `jsonObjectFrom`** (Kysely
   parity). The pair consistently describes the emitted shape (a JSON
   array/object from a subquery); `jsonAgg`/`jsonRow` was rejected as
   half-verbatim (no SQL function backs the single-row side).
3. **Foreign keys gain a column-level declaration:**
   `.references(() => users.id)`. One declaration feeds DDL and type
   layer — unlike Drizzle, where `.references()` builds the DDL but
   `relations()` must re-declare every edge for the query layer. The
   thunk defers evaluation (import-order safety, the Drizzle
   precedent). Self-referencing FKs cannot use it (a column map cannot
   reference its own table — the D100 TS7022 precedent) and composite
   FKs and FK actions stay on `extras`; both forms converge into the
   same `ForeignKeyDeclaration`, and declaring both over one column is
   a loud declaration-time error.
4. **The sugar method is `related()`**, not `with()` — a chain method
   named `with` would collide head-on with SQL `WITH` when #299 lands
   CTEs, violating "the surface reads as the SQL it emits". `related`
   pairs with `references` (declare: references → read: related).
5. **Relation keys: forward = FK column name with one trailing `Id`
   stripped (`ownerId` → `owner`); reverse = the schema map's export
   name.** Multi-FK-to-one-table resolves naturally (`authorId`/
   `editorId` → `author`/`editor`). A rename breaks call sites loudly
   (the key disappears from the type), never silently. Collisions
   (strip result equals a column name or another key) fail to
   type-check and require the explicit form.
6. **JSON round-trip honesty: cast + revive.** Inside `json_agg`,
   `bigint` collapses to a JSON number (silent precision loss past
   2^53) and datetimes to strings. The compiler casts at-risk columns
   to text; execution revives every nested value through the existing
   conversion machinery. A column types and arrives identically nested
   or top-level.
7. **v1 sugar scope: depth 1, `true` only.** No per-relation option
   objects (the Drizzle findMany path re-invents the query language
   inside an options bag). Growth drops to the base layer, which is
   naturally recursive. Sugar recursion can open later, dogfood-driven
   (D93).

## How it works

### The one new IR node

D94 (one shared vocabulary, no second IR) governs: core's `ExprNode`
gains a single select-as-expression node (a `SelectNode` embedded as a
scalar expression, tagged with its aggregation mode: json-array or
json-object). `exists()` already embeds a `SelectNode` in expression
position with a forced projection; this node is its generalization
with a real projection. Rendering reuses the existing correlation
hook — `renderSelect(query, outerScope)` already threads enclosing
scopes, and the `foreign-column-ref` diagnostic already names the
"reference from an enclosing query" concept. The renderer emits
`coalesce((select json_agg(json_build_object(...)) from ... where ...
), '[]'::json)` for arrays and the `json_build_object ... limit 1`
form for objects, with text casts on at-risk columns (bigint/numeric
string-mode/datetime/interval/bytea).

### The type-level edge

`.references(() => target.column)` records the edge in the column's
`TMeta` (the same vehicle `generated`/`identity` ride) — target table
identity and column key, plus the runtime `ForeignKeyDeclaration` the
extras path produces. `Table`'s public shape (D15) is untouched; no
second type parameter. Reverse edges are computed where all tables are
visible: `db(schema)` — the handle's declarations generic maps over
the schema record, so "who references posts" is derivable from the
map's own types. `related()`'s key domain and result shapes fall out
of that map; the runtime derivation reads the same
`ForeignKeyDeclaration`s (one truth, two readers — value/type axis
rule).

### Revive

The compiler already builds a column plan per statement; nested reads
extend the plan to a tree: each nested key carries the subselect's own
plan. `convertRow` walks the tree — parse the JSON cell, revive each
nested value by its column's declared type, recurse for
grandchildren. No new conversion logic: the per-type converters are
the existing ones.

## What this change does NOT touch

- D15 (`Table` shape) and D52 (snapshot FK targets stay resolved
  strings) are unchanged — stated to prevent drift.
- Snapshot format: unchanged. `.references()` produces the same
  snapshot fields the extras path does; `formatVersion` stays 6 (D73:
  vocabulary vs shape).
- No `groupBy`/lateral-join IR: the chosen SQL form needs neither.
- Aggregates (`count` etc.), CTEs, window functions: #299/#300's own
  cycles.

## Risks / open edges

- **Correlated subquery performance** on large child sets is the
  known cost of the json_agg form (one subquery per parent row in the
  plan; Postgres optimizes but not always). The explicit layer plus
  `compile()` keeps the SQL inspectable and replaceable; documenting
  the shape is part of the skill update.
- **`related()` type machinery depth** (reverse-edge map computation)
  is the riskiest type-level work; it lives behind the sugar only —
  the base layer carries no such machinery and ships even if the
  sugar's inference needs iteration.
- The `Id`-strip rule is a convention with edges (a column literally
  named `id` as an FK, unicode names); the collision rules in the
  spec delta bound them, and every ambiguity is a type error, never a
  guess.
