# Add Array Ergonomics

## Why

#349 made array element types honest — Postgres arrays are
element-nullable always, so every element reads and writes as
`T | null` — and the owner directed that this honesty must not cost
ergonomics (2026-08-28): consuming a nullable-element array today takes
per-site narrowing, and there is no way to declare the common case
("this array never holds NULL elements") so that the type can say `T`
truthfully. Drizzle types elements non-null by pragmatism, knows the
inference is wrong (drizzle-orm#2656), and cannot fix it without a
breaking change — hejbro, pre-1.0, can be right by default AND ship the
constraint-backed ergonomics Drizzle structurally cannot.

## What Changes

- `.array()` builders gain `.notNullElements()` (owner-settled name,
  2026-08-28 — no `$` prefix: the method emits real SQL, so it belongs
  to the schema-declaration family, not the type-only `$type` family):
  - the generated migration gains a CHECK constraint named
    `<column>_no_null_elements` whose expression is
    `array_position(<column>, null) is null` with the column reference
    rendered fully qualified (`"schema"."table"."column"`), exactly as
    every emitted check renders one — the database then enforces what
    the type claims;
  - the column's element type narrows to `T` (no `| null`) on read and
    write, honestly, because the constraint backs it;
  - calling it on a non-array column fails fast at declaration time.
- Result conversion fails fast if a `NULL` element ever arrives for a
  `notNullElements` column (defense in depth — e.g. the constraint was
  dropped out-of-band; the declared type must never lie silently).
- New exported utility `assertNoNulls(elements)` (owner-settled name and
  shape, 2026-08-28): runtime-checked narrowing of
  `ReadonlyArray<T | null>` to `ReadonlyArray<T>` — throws an explicit
  error naming the first null index; an unchecked assertion would
  reopen the lie channel #349 closed.

## Capabilities

### New Capabilities

- `table-declaration`: the table/column declaration DSL's own
  contract — first touched here by `.notNullElements()` (declaration
  surface, emitted CHECK, misuse failure). Grows as later changes touch
  more of the DSL (specs are never written retroactively).
- `value-utilities`: exported runtime helpers over declared-type
  values — first touched here by `assertNoNulls`.

### Modified Capabilities

- `query-type-inference`: array element types are `T | null` by default
  (writing #349's landed behavior into the spec at first touch) and
  narrow to `T` under `.notNullElements()`, on both the read and write
  side.
- `query-execution`: element-wise array conversion gains the
  `notNullElements` fail-fast — a `NULL` element arriving for a column
  declared `notNullElements` is a conversion failure naming the column,
  never a silently mistyped `null`.

## Impact

- `@hejbro/core`: column builder surface (`notNullElements` method +
  `TMeta` flag), read/write type mapping, `table()` deriving the CHECK
  into the declaration's own checks list (snapshot format untouched —
  the constraint rides the existing check machinery), new
  `assertNoNulls` export.
- `@hejbro/query`: element conversion honors the flag (fail-fast).
- `hejbro` facade: re-exports `assertNoNulls`.
- `@hejbro/pg` integration harness: real-server witness (CHECK present
  and enforcing, narrowing round-trip, `assertNoNulls` in action).
- Generated SQL: a CHECK per `notNullElements` column — new output, no
  change to any existing declaration's output (the method is opt-in).
- Release: minor (new capability), covered by the pending fixed-group
  changeset policy — this change ships its own changeset per D59.
