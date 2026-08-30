# Change: Check a scalar return expression's family against the declaration

## Why

A scalar function declared `returns: integer()` whose body returns a uuid
column is accepted at declaration time; Postgres accepts the `CREATE` and
raises a conversion error on the function's first call. `ctx.return(...)`
checks only the return *kind* (scalar / setof / trigger) and never
cross-checks the returned expression's type family against the declared
`returns` family — the exact extension of the body-shape contract this
capability already states: the declaration is the last place the mistake
is cheap (#478).

## What Changes

- `ctx.return(<expr>)` in a scalar-returning declaration compares the
  expression's `SqlTypeFamily` against the declared `returns` type's
  family and fails at declaration time with a new named diagnostic,
  `scalar-return-family-mismatch`, whose `Next:` names both families.
- The check refuses **only** family pairs a live Postgres 17 probe
  measured as failing for every probed value and member type (a
  value-independent failure of the coercion Postgres applies to a plpgsql
  `RETURN`). Value-dependent pairs stay accepted — hejbro is never
  stricter than Postgres. `Expr<"unknown">` (a `sql` fragment) is never
  refused; same-family pairs are never refused; declarations returning a
  text- or bytea-family type never refuse (measured: they accept every
  probed family through Postgres's IO conversion).
- The refusal table is data (one module), derived from the committed
  probe results; the measurement method, matrix, and per-pair grammar
  arguments live in this change's `design.md`.

## Impact

- Affected specs: `plpgsql-function-bodies` (one ADDED requirement).
- Affected code: `packages/core/src/plpgsql/body-context.ts`,
  `packages/core/src/dsl/define-function.ts`,
  `packages/core/src/dsl/define-trigger.ts`, one new
  `packages/core/src/plpgsql/return-family.ts` module, core tests.
  Core-only — no `query`/`pg`/`cli`/`supabase` contact.
- A declaration hitting a refused pair previously "worked" only until the
  function's first call, which always failed (measured); failing it at
  declaration time is a bug-fix-class tightening — `patch` changeset.
