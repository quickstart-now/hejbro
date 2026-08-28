# Add Generated Columns

## Why

The declaration DSL cannot express Postgres's `GENERATED` family —
computed (stored) columns and identity columns, the SQL-standard
successor to `serial` that Postgres's own documentation recommends —
so real schemas remain partly unwritable and the query layer's
insert-input inference was reduced to "notNull without a default is
required" (#308, filed when add-query-layer group 3 hit exactly that
wall). Owner decisions D100 (2026-08-28 brainstorm, seven-question
trail) settle the full surface.

## What Changes

- Column builders gain three methods (Drizzle-parity names, settled
  D100): `.generatedAlwaysAs(sql\`…\`)` for stored computed columns
  (the expression is a `sql` fragment naming sibling columns — the RLS
  predicate precedent; structured refs cannot exist inside the column
  map, and extras-side declaration would hide generated-ness from the
  type layer), and `.generatedAlwaysAsIdentity(options?)` /
  `.generatedByDefaultAsIdentity(options?)` with sequence options
  (`startWith`, `increment`, `minValue`, `maxValue`, `cache`,
  `cycle`). Identity methods are valid only on the integer family;
  misuse fails at `table()` naming the column.
- Generated migrations render the full `GENERATED` grammar on create,
  and diff with precise alters wherever Postgres allows in place:
  identity add / drop / kind change / option changes are `ALTER
  COLUMN` statements; an expression change and a plain→generated
  conversion are drop+add column (universal grammar, no new minimum
  Postgres version; plain→generated destroys stored data and routes
  through the existing destructive-change confirmation, while a
  generated column's data is derivable so its drop+add does not).
- Snapshot **formatVersion bumps 5 → 6**: the column snapshot gains
  optional `generated` (encoded expression fragment) and `identity`
  (kind + options) fields — a shape change, so older readers must get
  the existing newer-format diagnostic rather than silently ignoring
  the new fields.
- Insert/update input types classify the family (D100): an ALWAYS
  column (stored generated, identity always) has **no key at all** in
  `InsertInput`/`UpdateInput` — Postgres rejects those writes, so the
  type cannot express them; identity by-default behaves exactly like
  `hasDefault` (optional, writable). `OVERRIDING SYSTEM VALUE` is a
  documented non-goal.

## Capabilities

### New Capabilities

- `snapshot-format`: the snapshot file's externally observable format
  contract — first touched here by the 5→6 bump and the new column
  fields.

### Modified Capabilities

- `table-declaration`: gains the generated/identity declaration
  requirement (surface, emitted SQL, diff behavior, misuse failure).
- `query-type-inference`: the insert/update input requirement gains
  the generated-family classification (ALWAYS keys absent; by-default
  optional).

## Impact

- `@hejbro/core`: column builder surface + `TMeta`/`columnState`,
  `table()` validation, snapshot serialize/deserialize + version
  constant, table-kind emit and diff (identity alter paths, generated
  add/drop, drop+add conversions), golden coverage.
- `@hejbro/query`: `InsertInput`/`UpdateInput` gain the excluded-key
  classification (flows to every chain surface via #351's wiring).
- `@hejbro/pg`: integration witness — create-path grammar acceptance
  plus three runtime behaviors (identity assigns, generated computes,
  the DATABASE rejects an ALWAYS write).
- Existing snapshots: next `generate` rewrites `formatVersion` to 6;
  migration files untouched. Snapshot-bearing test fixtures update
  mechanically.
- `examples/` unchanged (non-goal — serial remains their idiom).
- Release: minor (new capability), one changeset on the first-landing
  piece per the established rule.
