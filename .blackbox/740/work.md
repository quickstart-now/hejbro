# Work — quickstart-now/hejbro#740

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Vendored client metadata lists columns in physical order

_2026-09-04T21:19Z_

`packages/cli/src/contract/tables.ts`'s `buildTableClientMeta` already
built `columns` from `computation.entries`, which is `table.columns` in
physical order, but the order was lost at `Object.fromEntries` (writer
side) and again at read time in `@hejbro/query`'s `synthesize.ts`
(`Object.entries(meta.columns)`) — JavaScript enumerates integer-like
keys ahead of every other key regardless of insertion order (`Object.
keys({ b, "2", a, "0" })` -> `["0", "2", "b", "a"]`), so no emitter-side
ordering could survive an object-keyed shape at all.

Fix (design.md shape A, the lead's pick over a sibling `columnOrder`
list): `ContractColumnEntry = ContractColumnMeta & { key: string }`.

- Writer (`packages/cli`): `TableClientMeta.columns:
  ReadonlyArray<ContractColumnEntry>`; `buildTableClientMeta` maps
  `computation.entries` directly to the array, preserving physical
  order. `emit.ts`'s `renderTableClientMetaEntry` renders one `{ key,
  sqlName, typeNode, mode, notNullElements }` entry per line in
  `entries` order; `renderMetadataKey`'s `__proto__` special-casing is
  no longer needed for a column key (a column's `key` is now a string
  *value*, not an object key) — it stays for table/function names.
- Reader (`packages/query`): `ContractTableMeta.columns` widened to a
  union, `ReadonlyArray<ContractColumnEntry> | { [tsKey: string]:
  ContractColumnMeta }` — kept for backward compatibility, since a
  contract vendored before this change still carries the object-keyed
  shape and must keep working without a re-vendor. A single
  `columnEntries(meta)` helper in `synthesize.ts` reads either shape
  (`Array.isArray` branch vs `Object.entries` branch), used for both
  `declaration.columns` and the `refsObject`.

A stale-dist regression was caught mid-task-1.4 (not by the in-process
package tests, which alias to source and can't see it): the real
cross-package `tsc` test in `examples/cli-smoke` failed with TS2345
because 1.5's type widening in `contract-types.ts` had never been
rebuilt into `@hejbro/query`'s `dist`. Fixed with `TURBO_FORCE=1 pnpm
--dir packages/query build --force` then a cascading `packages/cli`
rebuild; `examples/cli-smoke` green after.

Task commits: 1.5 (`0df1fe37`, the reader side, landed first per the
lead's reordering to avoid a churny intermediate state), 1.4
(`0c3556ef`, the writer side, two byte-golden contract-emit tests
refreshed to the new list rendering).

