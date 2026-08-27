# Design — add-array-ergonomics

## Context

#349 (dev `d93729c`) made array element types `T | null` on read and
write; the runtime already round-trips `NULL` elements (writer renders
the unquoted `NULL` token, `parseArrayText` returns `null`,
conversion passes it through). The declaration DSL builds columns as
`ColumnBuilder<TFamily, TMeta>` with `.array()` recording
`element: <typeName>` in `TMeta` and `columnState`; a table's checks
are hand-declared via `check(name, expr)` with mandatory names and
rendered-string snapshot storage; snapshot format v5 must not change
shape. Owner-settled surfaces (2026-08-28 AskUserQuestion trail):
method `.notNullElements()` (no `$` — it emits SQL, so it is
schema-declaration family, not the type-only `$type` family), utility
`assertNoNulls` (throwing form), CHECK name `<column>_no_null_elements`.

## Goals / Non-Goals

**Goals:**

- Element-type narrowing that is always constraint-backed — the type
  says `T` only when the database enforces it, end to end (declaration
  → migration → conversion guard).
- Zero snapshot-shape change: the constraint rides the existing check
  machinery.
- One-call consumption-side narrowing that stays honest (runtime
  checked).

**Non-Goals:**

- No general element-level constraint system (only the null axis).
- No auto-repair or filtering: `assertNoNulls` asserts, never drops
  elements; the conversion guard fails, never scrubs.
- No `$type`-style unchecked narrowing of the null axis (rejected —
  the `$type` constraint runs against the element before `.array()`
  wraps, so it can never vouch for the null axis).

## Decisions

1. **The CHECK is derived at `table()` build time into the
   declaration's own checks list** — name `<column>_no_null_elements`,
   expression built from structured nodes (`array_position` function
   call over a `columnRef` and a `null` literal, under an `is null`
   test), whose rendered text is fully qualified
   (`array_position("app"."posts"."tags", null) is null`) exactly like
   every hand-declared check — rather than at emit time or via a new
   snapshot node. (Settled during group 1 after a reviewer escalation:
   the renderer always qualifies column refs, so a bare-column text is
   unreachable via structured nodes; a raw-text fragment was rejected
   because structured refs keep rename retargeting and the check
   validation guards live.) Rationale: the
   snapshot then stores an ordinary check (shape untouched, no
   formatVersion question), diff/removal/drop ordering come free from
   the existing check machinery, and a collision with a hand-declared
   check of the same name is caught by the existing duplicate-name
   guard (verify at implementation; add the guard if checks lack one).
   Alternative considered — a `columnState`-only flag serialized into
   the column node: rejected, it would be a snapshot shape change and
   a second diff path for what is semantically a check.
2. **`TMeta` gains `notNullElements: true` (type-level) and
   `columnState` gains the same flag (runtime)** — the type mapping
   (`BaseTsType`'s array branch, `ColumnReadType`'s array-brand
   branch) drops the element `| null` when the flag is present;
   `MutationValue` follows automatically (it reuses `ColumnReadType`).
   The `columnState` flag is what `table()` reads to derive the check
   and what the query layer reads for the conversion guard; it is not
   itself serialized (the derived check is the serialized artifact).
3. **Misuse (`notNullElements()` on a non-array builder) throws at
   declaration time** via the existing error helper, code
   `invalid-not-null-elements`, message naming the fix ("only an
   .array() column holds elements"). Alternative — type-level-only
   prevention (conditional `never` return): kept AS WELL where cheap,
   but the runtime throw is the contract (a `(): never` arrow is not
   control-flow-recognized, g4 handoff note, so the type-level guard
   alone cannot be the only defense).
4. **Conversion guard lives in the existing element-wise conversion
   path** (`convertArrayValue`): a `null` element with the flag set
   routes to the existing `result-conversion-failed` fail-fast naming
   the column — same error family as every other conversion failure,
   no new error code.
5. **`assertNoNulls` lives in core** (pure function, no I/O), exported
   from core's barrel and re-exported by the `hejbro` facade; error
   code `null-array-element`, message naming the first null index and
   the fix ("filter first, or declare the column
   .array().notNullElements()"). It uses the existing `throwHejbroError`
   helper — `core/src/error.ts` itself is not modified, so the deferred
   enriched-Error conversion (owner: "next change that touches that
   file") is not triggered here.

## Risks / Trade-offs

- `array_position` requires a 1-D array; hejbro arrays are 1-D only
  (nested arrays have no write path), so the expression is safe for
  every declarable array — re-verify against PG17 in the integration
  witness.
- The narrowed type is only as true as the constraint's presence; the
  conversion guard (decision 4) is the backstop for out-of-band drops,
  and the spec says so explicitly.
- A user who already hand-declared a check named
  `<column>_no_null_elements` collides; the loud duplicate-name failure
  is the intended behavior (rename either side).
