# Proposal: scalar-function-returns

## Why

A scalar-returning `defineFunction` has no expressible body, and both
ways of writing one are broken (#424):

- `ctx.return(select(...))` records a `returnQuery` and emits
  `return query …`. Postgres rejects that at CREATE time — `ERROR:
  cannot use RETURN QUERY in a non-SETOF function` — so the migration
  stops during apply, after review, after the snapshot is hashed, in
  whatever tool the user applies migrations with (hejbro has no `apply`,
  D12). No diagnostic fires anywhere before that.
- An empty body generates a function Postgres accepts and then fails on
  at the first call ("control reached end of function without RETURN").

The cause is that `BodyContext` never knew what the declaration returns.
`ctx.return` accepted `TriggerRow | ReturnableQuery` and dispatched on
the *value*, while plpgsql decides on the *declaration*: `return query`
is legal only in a SETOF function, `return <row>` only in a trigger, and
a scalar function needs `return <expr>`, which no body could produce.

The repository's own state is the evidence: the only scalar-returning
declaration anywhere is a `db.fn` typing fixture whose body is `() => {}`,
with a comment explaining there is nothing for `ctx.return()` to do.

Design spec §6.2 states the compiler knows in advance what Postgres will
reject. For scalar functions it did not.

## What Changes

- **`ctx.return` accepts an expression**, recorded as a new
  `returnExpr` body statement and rendered `return <expr>;`. This is the
  scalar function's missing body form; a column reference, an argument
  reference and a `sql` fragment all already produce one.
- **The declaration's `returns` is threaded into the recorder**
  (`recordBodyWithGuard(identity, declaredAt, returnKind, run)`), so
  `ctx.return` validates the shape against it. Three named errors:
  `scalar-return-expects-expression` (a query or row in a scalar
  function), `scalar-return-in-non-scalar-function` (an expression in a
  setof or trigger body), `scalar-return-missing` (a scalar body that
  never returns).
- **No snapshot change.** A function's snapshot stores `bodySql` +
  `bodyHash` (the rendered text), not the statement tree, so a new
  `stmtKind` needs no codec entry and no `formatVersion` bump. The
  discriminator is a TypeScript-only union member and stays camelCase
  (D57).

## Capabilities

### New Capabilities

- `plpgsql-function-bodies`: the return contract — which shape each
  declaration form accepts, and the four failures it names. The
  capability had no spec; this change is the first to touch it, so it
  gets one covering exactly what is touched (D87).

### Modified Capabilities

None.

## Impact

- **Affected code**: `packages/core` (`plpgsql/body-ast.ts`,
  `plpgsql/body-context.ts`, `plpgsql/render-body.ts`,
  `dsl/define-function.ts`, `dsl/define-trigger.ts`),
  `skills/hejbro/references/function-builder-pitfalls.md`,
  and two `@hejbro/query` `db.fn` fixtures whose empty scalar bodies are
  now (correctly) refused.
- **Breaking**: declarations that were already broken stop compiling —
  a scalar function returning a query, and a scalar function with no
  return. Both produced SQL the database rejects, so nothing that worked
  stops working.
- **Decision log**: no new row. This implements what §6.2 already
  claims.

## Out of scope

- `ctx.execute()` / side-effect statements (#426) and the
  unrecorded-builder guard (#423) — the body's *statement* vocabulary is
  its own design round; this change adds one return form and no
  statements.
- `returns` accepting a column builder like `args` does (#424's third
  item). It cannot be done without cost: `ColumnBuilder<TFamily, TMeta>`
  carries only `TMeta.typeName`, so `varchar({length})`'s length and an
  enum's identity are absent at the type level, and normalizing a
  builder to a `TypeNode` would either lie about those or widen
  `TReturns` to bare `TypeNode` and cost `db.fn` its typed return —
  one of the project's three differentiators. Filed separately.
