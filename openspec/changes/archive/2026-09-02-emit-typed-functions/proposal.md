# Proposal: emit-typed-functions (#587)

## Why

`hejbro vendor` (#314) writes a contract carrying tables and enums, so a
consuming repository reads and writes the owning repository's tables
with the types the declarations gave them. It emits no function surface:
the `Functions` section of the generated `Database` interface is empty
by construction, and the name-keyed client has no `fn`. The owning
repository's `db.fn` is keyed by each function's export name, and #314
already carries that name in the export (a sixth fact a database cannot
be asked for) — but not the two facts a typed call needs beyond the
name: the TypeScript key each argument was declared under (the DSL
converts keys to SQL names one way, and the snapshot records only the
SQL names) and whether the return is a value or rows.

## What Changes

- The `defineFunction` declaration keeps each argument's declared key at
  runtime beside its SQL name (an additive field on the resolved
  argument list; no DSL surface changes).
- The export carries, per exported function, the argument keys in
  declaration order against their SQL names and the return shape
  (scalar / table). Additive fields; the description format version does
  not move (older readers treat absent facts as absent, the rule #314
  set).
- The contract emits `Functions` entries — export name → `{ Args,
  Returns }` types — with the same type mapping the table entries use,
  plus the runtime metadata the client needs (schema, SQL name, argument
  SQL names in order with their type nodes and modes, return kind).
- The name-keyed client exposes `fn`: callables that render the same
  parameterized invocation the declaring repository's `db.fn` renders,
  reusing `@hejbro/query`'s own function-call plan rather than a second
  renderer.
- Trigger-synthesized functions stay out by construction (no export
  name). A live witness calls a scalar and a table-returning function
  through a vendored contract against a real server.
- One `minor` changeset (new consumer-visible capability).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `schema-export` — "The export carries what the schema alone does not
  say": two more carried facts (argument keys against SQL names, return
  shape) and a scenario.
- `schema-vendoring` — ADDED "The contract carries a typed function
  surface": the `Functions` section, the client's `fn`, and four
  scenarios.

## Impact

- `packages/core/src/dsl/define-function.ts` (argument entry gains
  `key`), `packages/cli/src/export/description.ts` (function fact gains
  `args`/`returns`), `packages/cli/src/contract/*` (a `functions.ts`
  beside `tables.ts`; `emit.ts` fills `Functions` and the metadata),
  `packages/query/src/client/name-keyed-db.ts` (`fn`), their tests, the
  two-repository witness in `examples/`, `skills/hejbro/references/`
  (vendoring + query-layer), `.changeset/*.md`, `openspec/task-times.csv`.
- `@hejbro/core` changes only additively (a field on the runtime
  declaration). Export format: additive fields, same version.

## Out of scope

- Functions returning `setof` a table the schema does not own (no
  relation; same rule as foreign references).
- A function's structural signature beyond what a call needs (default
  values, variadics — not declarable today).
- `sync`'s module channel (retired by the git-channel pivot).
