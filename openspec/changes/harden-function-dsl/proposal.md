# Proposal: harden-function-dsl (#679 + #686)

## Why

Two declaration-time guards are missing from the function DSL, and both
let a declaration compile into SQL the database refuses:

- A `defineFunction` argument key is checked for reserved words only. Its
  SQL name is derived with the same `toSnakeCase` a column key uses, but
  never checked against D36, so `{ args: { "my-arg": uuid() } }` emits
  `create or replace function "app"."echo_arg"(my-arg uuid)` and
  `return my-arg;` — invalid Postgres, with no error from the CLI (#679,
  measured in the fix-vendoring-compat evaluation).
- `ctx.return` accepts a mutation that never called `.returning()`.
  `ReturnableQuery`'s mutation members are `InsertFinal<Table,
  ReturningProjection | undefined>` and the pre-returning stage is
  `InsertFinal<Table, never>`, so `never` slips into the union and the
  body renders `return query insert into … values (…);` — a `return
  query` over a command that produces no rows, which Postgres rejects
  (#686).

The second is the exact mirror of a guard that already ships:
`ctx.execute` refuses a mutation that *carries* `.returning()`
(`execute-expects-no-returning`). The returning form belongs to
`ctx.return`, the non-returning form to `ctx.execute`; only one half of
that pairing is enforced today.

## What Changes

- `defineFunction` derives each argument's SQL name from its key exactly
  as before and then applies D36 (`^[a-z][a-z0-9_]*$`), refusing a
  non-conforming name with `invalid-sql-name` — the same code, the same
  sentence a column key's refusal already carries — naming the function,
  the declared key and the derived name. The reserved-word refusal
  (`reserved-local-name`) is unchanged. Quoting argument names in the DDL
  is rejected: it contradicts the explicit-name design and grows the body
  escaping set.
- `ctx.return` accepts a mutation only when its chain ends in
  `.returning()` (bare or projected). The rejection is type-level first —
  a pre-returning stage is no longer assignable — and backed at
  declaration time by `return-expects-returning` for a caller that
  bypasses the type. `ctx.execute` keeps accepting both stages.
- The two fixtures that declare a hostile argument key
  (`packages/cli/test/contract-emit.test.ts`,
  `examples/cli-smoke/test/vendored-contract.test.ts`) move that key to
  the hand-edited export fact, the path the column half already uses — so
  the emitter's argument-key quoting keeps its observer, including the
  real-`tsc` one.
- One `patch` changeset; `skills/hejbro` documents both refusals.

## Capabilities

- `function-declaration` — ADDED: an argument name is a hejbro SQL name.
- `plpgsql-function-bodies` — ADDED: a returned mutation carries a
  returning clause.
- `schema-vendoring` — MODIFIED: "Every emitted key compiles" states
  where a non-identifier key comes from (the export it reads, never a
  declaration) and drops the paragraph promising that a declaration
  carrying a non-identifier argument name still produces invalid
  migration SQL — that gap is what this change closes.

## Impact

- Group 1: `packages/core/src/dsl/define-function.ts`;
  `packages/core/test/define-function.test.ts` (the declaration surface's
  own suite, where the refusal's input table lands);
  `packages/cli/test/contract-emit.test.ts` and
  `examples/cli-smoke/test/vendored-contract.test.ts` (fixture inputs
  only — same assertions, same emitter).
- Group 2: `packages/core/src/query/mutate.ts`,
  `packages/core/src/plpgsql/body-context.ts`; new core tests (one
  runtime, one type pin proved by `check-types`, never by vitest);
  `skills/hejbro/references/function-builder-pitfalls.md`;
  `.changeset/harden-function-dsl.md`.
- `@hejbro/query` constructs mutation stage types, so `check-types` runs
  workspace-wide, never filtered.
- Refs #679, #686.
