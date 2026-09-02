# Proposal: fix-vendoring-compat (#676)

## Why

The D106 reviews of `emit-typed-functions` (#587) and `fix-mutation-result-type`
(#622) left five defects on the vendoring boundary that a consumer meets the
moment they upgrade `hejbro` or vendor a schema with an unusual column:

- A `.hejbro/export/schema.json` written before #587 (format 1, no function
  `args`/`returns`) is refused by the reader instead of read with those facts
  absent — the opposite of what the schema-vendoring spec promises for an
  older format (#657).
- A `contract.ts` vendored before #587 carries no `functions` key and crashes
  `createNameKeyedDb` with a raw `TypeError` (#659).
- The vendored client's bare `insert()` (and `update()`/`delete()`) promise
  rows in their type while the statement carries no `RETURNING` and resolves
  to an empty array (#654 — #622's fix never reached the name-keyed wrapper).
- A column or function argument declared under a non-identifier key is emitted
  unquoted, so the contract does not compile (#662).
- An `interval` column or argument reaches the contract as an unresolved
  `IntervalValue` identifier (#661).

Alongside them, the typed-function requirement's "A mismatched call fails the
type check" scenario over-claims the extra-argument case (#660): TypeScript's
excess-property check only fires on a fresh object literal.

All six sit on published surfaces (`hejbro vendor`'s reader and emitter,
`@hejbro/query`'s client), so they go through one change before 0.2.0.

## What Changes

- The export reader accepts a format-1 description whose function facts carry
  no `args`/`returns`; such a function is read but not carried into the
  contract's `Functions` section (the facts a typed call needs are absent).
- `createNameKeyedDb` accepts contract metadata with no `functions` member and
  exposes an empty `fn`.
- The name-keyed client's bare `insert()`/`update()`/`delete()` type as
  resolving to no rows (`ReadonlyArray<never>`), matching what they send.
- The contract emitter quotes any table column key or function argument key
  that is not a valid identifier, and its header imports the `interval` value
  type it names.
- The mismatched-call scenario says what TypeScript observes: missing or
  mistyped arguments fail to compile; an extra property fails on a fresh
  object literal and is refused at runtime otherwise.
- One `patch` changeset; the polyrepo and query-layer skill references say
  what a bare vendored mutation returns and that older exports still read.

## Capabilities

- `schema-vendoring` — MODIFIED: older-format reading (the "not yet observable"
  paragraph closes with a real fixture), the typed-function surface's
  mismatched-call scenario; ADDED: a vendored mutation's type matches its
  result, a contract without functions still runs, non-identifier keys and
  `interval` compile.

## Impact

- `packages/cli/src/vendor/validate-export.ts` (optional function facts on
  read), `packages/cli/src/contract/{functions,tables,ts-type,emit}.ts`
  (quoting, interval import, uncarried legacy functions).
- `packages/query/src/client/{contract-types,name-keyed-db}.ts` (`functions`
  optional at runtime, mutation result types).
- `examples/cli-smoke` real-`tsc` fixtures for the quoting and interval cases.
- `skills/hejbro/references/{polyrepo,query-layer}.md`; `.changeset/fix-vendoring-compat.md` (`patch`).
- Closes #657, #659, #654, #662, #661, #660.
