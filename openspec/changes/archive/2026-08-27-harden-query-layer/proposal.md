# Proposal: harden-query-layer

## Why

The first query-layer release candidate carries six known defects and
debts filed during `add-query-layer`'s own implementation (#310, #315,
#320, #322, #323, #326). Two of them are first-contact defects — a user
who declares a `bigint`/`numeric` mode or an `interval` column cannot
insert the very values the column's read type promises (#322), and
array columns of those types fail at result conversion (#320) — so the
owner ruled (2026-08-27): clear this set before the 0.2.0 release
rather than shipping it as the query layer's first impression.

## What Changes

- **Array result conversion** (#320): array columns of moded
  numeric/bigint and `interval` convert element-wise to the types the
  declaration promises; `@hejbro/pg` extends its per-query override so
  `interval[]` (oid 1187) arrives as raw Postgres text, and the
  conversion layer parses Postgres array text. The driver-contract
  arrival-shape table and the interval sentences lose their
  deliberately-narrowed "single (non-array) columns" scoping.
- **Write-side value types** (#322): the mutation builders accept the
  same TypeScript types the column DSL declares as read types
  (mode-resolved `bigint`/`number`/`string`, structured
  `IntervalValue`), and the compile-time lift serializes them to bind
  parameters.
- **Checkout honors the driver's own hook** (#323): `@hejbro/pg`'s
  checkout pin calls the driver value's `setupSession` property (late
  bound) instead of the module closure, so decorator-wrapped hooks take
  effect; the spec sentence deliberately withheld at task 7.7 of the
  previous change ("checkout goes through the hook property") lands.
- **`Tx.execute` typed** (#326): `Tx.execute` resolves
  `ExecuteResult<TStatement>` like `Db`/`ScopedDb` — restoring the
  already-specified "rows typed by the statement's inferred result
  type" on the one surface that under-promised.
- **Debt** (#310, #315): the default numeric modes become structurally
  derived from single constants (no exhaustiveness-assertion
  weakening), and the two deferred branches from the execution piece
  (`fn.ts` unresolved-scalar guard, `context.ts` empty-roles message)
  gain coverage. No behavior change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `driver-contract`: the arrival-shape requirement extends to array
  columns (`interval[]` raw text via the per-query override; moded
  numeric/bigint arrays as pg's default text-element arrays), and the
  session-setup requirement gains the checkout-goes-through-the-hook
  sentence.
- `query-execution`: result conversion extends element-wise to array
  columns; the conversion-failure contract (`result-conversion-failed`,
  column named) covers array elements.
- `query-type-inference`: mutation input value types accept the
  declared read types (mode-resolved numerics, `IntervalValue`); array
  columns' insert values follow the same element rule.

## Impact

- **Packages**: `@hejbro/core` (mutation value types, mode constants),
  `@hejbro/query` (conversion layer, lift/serialization, `Tx` typing),
  `@hejbro/pg` (1187 override, late-bound hook). All published — one
  `minor` changeset (post-D83 policy).
- **No breaking changes**: every change widens acceptance or restores
  promised types; existing green code stays green.
- **Sequencing**: lands before the 0.2.0 release (the #289 Version
  Packages PR waits for this change by owner decision, 2026-08-27).
- Issues #310/#315/#320/#322/#323/#326 close when this change's groups
  merge; #282 tracks the phase.
