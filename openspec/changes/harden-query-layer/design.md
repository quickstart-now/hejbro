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
- **Write-side serialization is compile-time lifting**: a structured
  interval value supplied to a mutation lifts to a bind parameter in
  Postgres interval literal text built from its seven fields; numeric
  mode values lift as their own text/bigint/number forms (the client
  library already serializes those losslessly).
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

## Open Decisions ([design] tasks — settled with the owner before code)

1. **Write-acceptance unions** (task 2.1): strict-only (each column
   accepts exactly its read type: default `bigint` mode accepts
   `bigint`, not `number`; `interval` accepts only the structured
   value) versus convenience widening (`bigint` mode also accepts
   safe `number`, `interval` also accepts literal text). The spec
   delta as written assumes strict-only (the third scenario rejects
   `number` into a `'bigint'`-mode column); widening would loosen that
   scenario and needs the owner's call on where "type honesty" ends
   and convenience begins.
2. **Interval serialization canonical form** (task 2.2): the exact
   Postgres interval literal built from the seven fields (sign
   handling, zero-field elision vs always-full form) — settles a
   generated-SQL-adjacent text contract, so it is owner-gated by the
   same rule as SQL text decisions.

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

Additive/widening only: existing code keeps type-checking; new value
shapes become accepted; array reads that previously threw now convert.
One `minor` changeset (all three published packages move via the fixed
group). Rollback = revert the change PRs before release.
