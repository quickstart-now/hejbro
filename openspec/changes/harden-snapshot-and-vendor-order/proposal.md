# Proposal: harden-snapshot-and-vendor-order (#701 + #740 + #749)

## Why

Three places where the order or the shape of what hejbro emits stops
meaning what the declaration meant — each deterministic, none of them
loud:

- A kind's `diff` decides "changed" by comparing the two serialized
  nodes byte for byte (`sameJson`), every kind except `table`. For an
  array whose members form a set — a policy's `roles`, a trigger's
  `events` and an `update of` event's column list — a declaration that
  lists the same members in a different order serializes differently,
  so the diff reports an `alter` and the migration drops and recreates
  the policy or the trigger for nothing. `table`'s own diff is
  name-keyed, so reordering `indexes` or `checks` produces no alter —
  but the snapshot bytes still move, and `generate` writes a
  zero-statement `restate_<table>` migration and advances the hash chain
  for a change the database never sees. `grant.privileges` and
  `table.foreignKeys` already serialize in a canonical order (the DSL
  normalizes them); the rest do not (#701).
- A vendored contract's `contractMetadata.tables[t].columns` is a
  JavaScript object keyed by TypeScript key. The name-keyed client
  rebuilds the table from `Object.entries` of that object, and
  JavaScript enumerates integer-like keys first whatever order the
  emitter wrote — so a consumer's statements list `"0", "2", "id", …`
  while the snapshot, the emitted `Row` interface and the owning
  repository's own `db` list `id, …` in physical order. Lossless and
  deterministic, but the explicit column list no longer mirrors the
  database's physical order, which is what an explicit list is for
  (#740).
- Under `returns setof <table>`, `ctx.return(...)` accepts a mutation
  with a projected `.returning({ … })`, and a select with a column
  projection or over another table. Postgres accepts the `CREATE
  FUNCTION` and matches `return query`'s columns against the declared
  table positionally, by count and type, names ignored: a partial
  projection fails on the first call (`structure of query does not match
  function result type`), and a complete one in the wrong order with
  coincident types is silently wrong. The declaration is the last cheap
  place to catch it; a projected returning had no valid use under setof,
  and trigger and scalar bodies refuse every query already (#749).

## What Changes

- Set-shaped snapshot arrays get one canonical order, written when the
  snapshot is built and read at every comparison — a kind's diff,
  `generate`'s "did the snapshot move", and `verify`'s "does the file
  match the declarations": a policy's `roles`, a trigger's `events` (and
  each `update` event's column list), a table's `indexes` and `checks`.
  Declarations that differ only in such an order serialize identically
  and generate nothing; a snapshot written before the order was
  canonical compares equal to its canonical rewrite, so upgrading
  generates nothing and verifies clean. The hash chain stays byte-exact.
  Ordered arrays — physical columns, index columns, foreign-key column
  pairs, function arguments, enum values, view columns, every expression
  node — are untouched. `formatVersion` stays 8 (the format-bump
  alternative is written up in design.md for the lead).
- The vendored client metadata carries a table's columns in physical
  order — the structure is a `[design]` decision — the emitter writes it,
  and the name-keyed client reads it, so the statements a consumer sends
  list columns in the same order the owning repository's own client
  does. A contract vendored with the object-shaped metadata still builds
  a client.
- `ctx.return(...)` under `returns setof <table>` accepts only a query
  whose rows are that table's whole row: a select of that table, or a
  mutation on that table ending in a bare `.returning()`. A projection,
  or a query over another table, is refused at declaration time with a
  coded error naming the forms that work. The accepted type narrows to
  match, so the mistake is a compile error where TypeScript can see it.
- One `patch` changeset; `skills/hejbro` states the whole-row rule and
  the physical-order metadata.

## Capabilities

- `snapshot-format` — ADDED: a set-shaped array is recorded in canonical
  order.
- `snapshot-diff` — ADDED: a set-shaped array's order never makes a
  change.
- `cli-commands` — ADDED: a set's order is never a snapshot movement
  (`generate`'s no-change decision and `verify`'s declaration match read
  the canonical form; the hash chain stays byte-exact).
- `schema-vendoring` — ADDED: the client metadata lists columns in
  physical order.
- `plpgsql-function-bodies` — REMOVED: "A projected returning is a
  returnable query" (its only shipped use fails at first call);
  ADDED: a setof body returns the declared table's whole row;
  MODIFIED: "A returned mutation carries a returning clause" (its
  accepted returning form is the bare one).

## Impact

- One group, one team, sequential. Core: `packages/core/src/kinds/
  {policy-kind,trigger-kind,table-kind}.ts`, `packages/core/src/kind/
  object-kind.ts` (an optional, additive canonical-form member — if the
  lead settles on the hook), `packages/core/src/snapshot/snapshot.ts`,
  `packages/core/src/engine/{diff-engine,generate}.ts`,
  `packages/core/src/plpgsql/body-context.ts`; their tests. CLI:
  `packages/cli/src/commands/verify.ts` (check 2 reads the canonical
  form), `packages/cli/src/contract/{tables,emit}.ts`, their tests, and
  the golden snapshots and the two examples (snapshot and migration
  banners) whose committed bytes carry a non-canonical order — replayed
  once, as the last format bump did. Query (boundary
  question for the lead — the runtime reader lives there):
  `packages/query/src/client/{contract-types,synthesize}.ts` and one
  test. Skills: `skills/hejbro/references/{function-builder-pitfalls,
  polyrepo,extension-interface}.md`. `.changeset/harden-snapshot-and-vendor-order.md`.
- Core stays pure: no I/O, no runtime dependency. Generated SQL changes
  only where a set was rendered in declaration order (`create policy …
  to <roles>`, `create trigger … after <events>`), and only for objects
  created or recreated after this change; a project's committed
  migrations outside this repository are history and do not move.
- Refs #701, #740, #749.
