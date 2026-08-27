# Design: harden-query-layer

## Context

Six defects/debts filed during `add-query-layer`'s own implementation,
owner-ruled (2026-08-27) to clear before the 0.2.0 release. Constraints
unchanged from that change: core and query stay pure, drivers wrap
client libraries, house style (no classes/let/for/ternary, CRAP ≤ 5),
errors are kebab-coded enriched plain `Error`s, explicit over implicit.
The main specs now live in `openspec/specs/` — two of the six items
extend deliberately-narrowed spec boundaries, which is why this is an
OpenSpec change rather than six plain-cycle fixes.

## Goals / Non-Goals

**Goals**

- Array columns of moded `bigint`/`numeric` and `interval` convert
  element-wise on read (#320); `interval[]` arrives as raw array text
  from `@hejbro/pg` (oid 1187 joins the per-query override).
- Mutation inputs accept the declared read types and round-trip (#322).
- The checkout pin goes through the driver value's own hook member so
  decorators take effect (#323).
- `Tx.execute` resolves `ExecuteResult<TStatement>` (#326).
- Default numeric modes derived from single constants (#310); the two
  deferred branches covered (#315).

**Non-Goals**

- No new query capabilities (chains, builders, drivers unchanged in
  surface). No left-join nullability (#307/#311), no savepoints (#313),
  no preset features (#317/#318). Nested array element conversion
  beyond one level follows the DSL's own existing one-level `element`
  recording — deeper nesting stays out, matching the type layer.

## Decisions

- **This change wraps all six** even though #310/#315/#326 alone would
  be plain-cycle: #320/#323 move spec sentences, #322 changes the
  public type surface, and one change keeps the pre-release hardening
  reviewable as a unit.
- **Array text parsing lives in `@hejbro/query`** as a small pure
  parser for Postgres array literal text (quoted elements, escaped
  quotes/backslashes, `NULL` elements) in its own module — the
  conversion layer feeds `interval[]` raw array text through it, then
  each element through the existing interval parser. Moded
  numeric/bigint arrays need no text parser: pg's default already
  hands an array of decimal text elements, which map through the
  existing per-element conversion.
- **Write-side serialization is compile-time lifting to canonical text**:
  a structured interval value supplied to a mutation lifts to a bind
  parameter in Postgres interval literal text built from its seven
  fields; a `bigint`/array mutation value lifts to its own canonical text
  form the same way — the AST stays JSON-serializable throughout
  (mirroring the existing `timestamp`/`isoValue` precedent), never a raw
  `bigint`/structured value/JS array. This is `query/column-value.ts`'s
  `liftColumnValue`, a function private to `mutate.ts`'s own three call
  sites — the pre-existing `liftLiteral`/`liftOperand` (the declaration-
  path lifter `.default()`/comparison operators use) is unchanged.
- **Late binding for the hook** (#323): the checkout guard reads
  `driver.setupSession` at checkout time. The tsdoc-promised
  per-driver guard scope (g5's GAP-3 note) gets its test in the same
  task.
- **`Tx.execute` generics** (#326) thread `ExecuteResult<TStatement>`
  through BOTH `Tx` creation sites (`transaction.ts` and the scoped
  transaction in `context.ts`) — the four-entry-point lesson from the
  previous change.
- **#310 mechanism**: the default-mode constants move to their own
  module (out of the factory module that the C19 exhaustiveness sweep
  scans), and `ts-type-map.ts`'s hand-spelled fallbacks become
  `typeof` references — exactly the issue's recorded path; the C19
  assertion is never weakened.

## Settled Decisions (owner round, 2026-08-27 — formerly Open)

1. **Write-acceptance unions = STRICT** (task 2.1): each column accepts
   exactly its declared read type — default `bigint` mode accepts
   `bigint` and rejects `number`; a `'string'`-mode `numeric` accepts
   `string`; `interval` accepts only the structured value. Rationale:
   round-trip identity holds at the type layer with zero runtime
   validation branches, Drizzle's insert model is mode-symmetric the
   same way, and convenience already has its first-class expression —
   declaring the mode (`bigint({mode:'number'})`) — so widened unions
   would duplicate that mechanism implicitly. The spec delta's reject
   scenario stands as written.
2. **Interval serialization = always-full IntervalStyle-postgres form**
   (task 2.2): `"{Y} years {M} mons {D} days {±H:MM:SS.ffffff}"`, all
   three axes always present, per-axis signs — exactly the grammar the
   read-side parser consumes, so round-trip symmetry is visible at the
   grammar level and serialization has zero elision branches. The
   serialize function body lives in `@hejbro/core` (`liftColumnValue`'s
   own AST-must-stay-JSON-serializable constraint requires it there;
   `@hejbro/query`'s own `types/interval.ts` re-exports it, "beside the
   parser" as an import path, mirroring `IntervalValue`'s own D94
   precedent); a pure property test pins `parse(serialize(v)) =
   canonicalize(v)` (axis-internal normalization only, never across an
   axis boundary). The real-database read half of the grammar is already
   proven by group 1's harness — the server parses a **normalized
   variant** of its own output grammar, not byte-identically its own
   output (Postgres's own output is singular for a magnitude of 1 and
   elides zero axes; this project's always-full form is plural and
   never elides), which depends on the additional fact that Postgres's
   *input* grammar accepts both singular/plural unit forms and explicit
   zero axes. A real-server capture of that acceptance (not just the
   parsed structured value) lands via issue #341, not reproduced here.

## Risks / Trade-offs

- [Postgres array literal parsing has corner cases (quotes, escapes,
  `NULL`, empty array)] → the parser is pure and property-tested
  against strings produced by a real Postgres in the driver's existing
  Docker harness; unparsable array text fails fast with the existing
  conversion error contract, never a partial array.
- [Widening mutation value types could mask wrong-type writes] → the
  open decision above is settled with the owner first; either way the
  compile-time lift rejects shapes outside the settled union.
- [Touching the checkout guard risks the pin contract] → the previous
  change's pin scenarios (once-per-connection, retry-on-failure,
  before-first-statement) are already mutation-bound; the late-binding
  task must keep them green untouched.

## Migration Plan

**Narrowing on the write path**: mutation values now require each
column's declared read type — a default-mode `bigint` column no longer
accepts `number`, and a datetime column no longer accepts an ISO string
(the declaration and comparison paths are unchanged: `LiftableFor` still
accepts `Date | string`). Code affected either declares the matching mode
(`bigint({mode:'number'})`) or passes the declared type. Reads are
additive: array reads that previously threw now convert.

One `minor` changeset (all three published packages move via the fixed
group). Rollback = revert the change PRs before release.
