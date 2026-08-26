# Proposal: add-query-layer

## Why

hejbro declares the whole database in TypeScript but stops at migration
SQL — every query against that schema is written blind, outside the type
information the declarations already hold. The owner settled the product
pivot (2026-08-26, eight-decision ledger, decision log rows D91+):
hejbro grows into a PostgreSQL/serverless-specialized ORM/query builder
where the schema DSL is the single source of truth for migrations AND
query types. This change specifies the v1 query layer (tracking issue
#293, the first OpenSpec change under D87).

## What Changes

- New package `@hejbro/query` (pure, core-grade constraints): statement
  IR + deterministic compiler on top of core's ExprNode vocabulary;
  conventional query-builder surface for `select` (columns, `where`,
  `order`, `limit`, inner/left join), `insert`, `update`, `delete`, with
  `returning`; explicit column lists only — never `select *` /
  `returning *`; a typed `sql` tagged-template escape hatch; pure
  `compile()` producing previewable SQL + parameters.
- New package `@hejbro/pg`: vanilla Postgres driver wrapping `pg` (never
  a wire protocol) under a capability-declaring driver contract whose
  types live in `@hejbro/query`; a missing capability is an explicit
  error, never a silent fallback.
- `@hejbro/supabase` gains its own driver and the preset-typed RLS
  execution context (`asUser(jwt)` / `asAnon`) over the generic
  mechanism defined in `@hejbro/query` (role + `set_config` list,
  transaction-wrapped `SET LOCAL`, pooling-safe).
- Typed function execution `db.fn.*` derived from `defineFunction`
  declarations — differentiator surface.
- Result and input types inferred from the schema declarations at the
  type level (no codegen, no `.d.ts` generation); `jsonb` stays
  `unknown` unless branded with an opt-in `$type`.
- Transaction API on the `db` handle; RLS context execution requires the
  driver's transaction capability.
- `@hejbro/core` stays unchanged in behavior and purity; boundary rule:
  the snapshot serializes only declaration-reachable ExprNodes.

Deferred out of v1 (parked as sub-issues of #282): relational query
layer (#298), CTE/window functions/set operations beyond the escape
hatch (#299), `@hejbro/neon` (#300), `@hejbro/nile` (#301), startup
verify assertion (#302), prepared-statement caching (#303).

## Capabilities

### New Capabilities

- `query-builder`: building typed statements (select/insert/update/
  delete/returning, joins, where/order/limit, ExprNode condition
  helpers, typed `sql` escape hatch) and compiling them purely to
  SQL + parameters.
- `query-type-inference`: mapping schema declarations to TypeScript
  result/input types at the type level, including the `jsonb` `$type`
  opt-in brand and the no-codegen guarantee.
- `driver-contract`: the capability-declaring driver interface, the
  `@hejbro/pg` and Supabase drivers, and the explicit-error rule for
  missing capabilities.
- `query-execution`: the `db` handle — executing compiled statements
  through a driver, the transaction API, and execution-time error
  shapes.
- `rls-execution-context`: the generic role + `SET LOCAL` context
  mechanism and the preset-typed context surfaces built on it.
- `typed-function-execution`: the `db.fn.*` surface derived from
  `defineFunction` declarations.

### Modified Capabilities

None — `openspec/specs/` is empty; these are the first specs (D87: no
retroactive specs, a capability gets its spec when a change first
touches it).

## Impact

- New packages `@hejbro/query`, `@hejbro/pg`; new runtime dependency
  `pg` confined to `@hejbro/pg`.
- `@hejbro/supabase` grows a driver + context surface (uses only core's
  and query's public extension interfaces).
- `@hejbro/core` public surface: ExprNode vocabulary is consumed by
  `@hejbro/query`; no behavior change, purity untouched (adding any
  runtime dependency to core stays owner-gated and is not needed).
- Decision log: rows D91+ in `docs/specs/2026-08-19-hejbro-design.md`
  (owner-gated; the proposal PR merge is the approval).
- Open question (recorded, not decided here): release mechanics for the
  new packages — fixed-group membership in `.changeset/config.json` and
  first-version policy. New-capability releases are `minor` (post-D83
  policy).
- Tests: each capability spec pairs with new vitest suites in the new
  packages; examples gain query-layer usage later via their own change.
