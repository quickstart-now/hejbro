# Proposal: add-relational-reads

## Why

Reading a parent with its children today means either a flat join the
application must re-group by hand, or falling out to `sql``. D92
positioned a relational layer as "an optional layer on top, never the
base" and D98 parked it as #298; the query layer it builds on has
shipped. The owner settled the design in a seven-decision brainstorm
(2026-08-28): a two-layer read surface whose base is explicit,
SQL-visible correlated subqueries and whose sugar is derived from the
foreign keys the schema already declares — no second relations
declaration, ever.

## What Changes

- **Column-level foreign keys**: `.references(() => users.id)` on a
  column builder declares the same foreign key the `extras` path does —
  one declaration feeds the DDL *and* the type layer (the edge survives
  in `TMeta`). Self-referencing and composite foreign keys stay on the
  `extras` path (a column map cannot reference its own table — the
  D100 TS7022 precedent); both paths converge into one
  `ForeignKeyDeclaration`.
- **Base layer — explicit nested reads**: `jsonArrayFrom(subselect)`
  (collection → `ReadonlyArray<Row>`) and `jsonObjectFrom(subselect)`
  (single row → `Row | null`) wrap a core `select(...)` chain into a
  projection expression, compiled as a correlated scalar subquery with
  `json_agg`/`json_build_object` — fully visible in `compile()`. The
  statement IR gains the one missing node (a select-as-expression);
  D94's single-vocabulary rule holds (core owns the node, no second IR).
- **Sugar layer — `related()`**: `db(h).select(posts).related({
  comments: true, owner: true })` derives the same correlated subqueries
  from declared foreign keys. Reverse (collection) keys are the schema
  map's own export names; forward (single-row) keys are the FK column
  name with a trailing `Id` stripped. v1 sugar is depth 1 and `true`
  only — anything richer drops to the base layer, same syntax family.
  (`with` was rejected: it would collide with SQL `WITH` — #299's CTEs.)
- **JSON round-trip honesty**: inside `json_agg`, `bigint` silently
  loses precision past 2^53 and datetimes arrive as strings. The
  compiler casts at-risk columns to text and execution revives every
  nested value through the existing conversion pipeline — a column has
  the same TypeScript type nested or top-level, with zero silent loss.
- Empty collections arrive as `[]` (never `null`); a missing forward
  row arrives as `null`.
- **Canonical foreign-key order (D1)**: a table's foreign keys emit and
  snapshot sorted by a form-independent key, so mixing or converting
  declaration forms never reorders DDL or snapshot bytes — without
  this, converting an extras foreign key to `.references()` produced a
  diff no-op whose snapshot still differed, wedging `hejbro verify`
  with no `generate` path out. Snapshot `formatVersion` bumps to 7.

## Capabilities

### New Capabilities

None — every piece lands in an existing capability.

### Modified Capabilities

- `table-declaration`: column-level `.references()` declaration (new
  requirement; DDL and diff output unchanged from the extras path).
- `query-builder`: `jsonArrayFrom`/`jsonObjectFrom` expressions, the
  select-as-expression statement form, and the `related()` chain method.
- `query-type-inference`: foreign-key edges reach the type level;
  `related()` key derivation and nested row types (same declared read
  types as top-level, forward rows `| null`).
- `query-execution`: nested revive — values inside JSON payloads arrive
  as their declared read types; the casts that make it possible are
  visible in `compile()`.
- `snapshot-format`: `formatVersion` 6→7 — foreign keys record in one
  canonical, declaration-form-independent order (D1, settled at group 1
  review; v6 was never released, so no released user crosses the bump).

## Impact

- **Affected code**: `packages/core` (column builder `.references()`,
  statement IR node + renderer, `jsonArrayFrom`/`jsonObjectFrom`
  builders), `packages/query` (`related()` chain surface, FK-edge type
  inference, nested column plans + revive), `packages/pg` integration
  witness, `skills/hejbro` (query-layer reference + cheatsheet),
  examples.
- **Breaking**: none — every surface is additive; existing extras
  foreign keys keep working unchanged.
- **Decision log**: adds one row (the seven settled decisions);
  no existing decision is amended. D15's `Table` shape is untouched
  (the edge rides `TMeta`, not a new type parameter); D52's
  string-resolved snapshot targets stay as they are.
