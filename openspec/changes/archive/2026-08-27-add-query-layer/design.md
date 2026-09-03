# Design: add-query-layer

## Context

hejbro today is declaration → snapshot → diff → migration SQL, with
`@hejbro/core` pure and providers behind a single extension interface.
The owner-settled eight-decision ledger (decision log rows D91–D98 in
`docs/specs/2026-08-19-hejbro-design.md`; that log carries the
rationale — this document only records the resulting shape) extends the
product with a query layer. See `proposal.md` for motivation and the
capability list; the delta specs carry the behavior contracts.

Constraints that shape the design: core purity is load-bearing; the
provider interface is the product (no core special cases); TypeScript
strict with the house style (no classes — `HejbroError` in
`packages/core/src/error.ts` is a grandfathered exception awaiting its
own change); explicit SQL over implicit (`select *` / `returning *` are
banned by owner decision).

## Goals / Non-Goals

**Goals:**

- v1 cut (A): select (columns/where/order/limit, inner+left join),
  insert, update, delete, `returning`, ExprNode condition helpers, typed
  `sql` escape hatch, `db.fn.*`, `db.as` + transaction API, `@hejbro/pg`
  plus a Supabase driver.
- Keep `@hejbro/query` as pure as core: IR + compiler only, no I/O.
- One driver contract; platform differences expressed as declared
  capabilities, never behavioral forks in the query layer.

**Non-Goals:**

- Relational query layer, CTE/window/set operations, `@hejbro/neon`,
  `@hejbro/nile`, startup verify assertion, prepared-statement caching
  (all deferred; parked as #298–#303 under #282).
- Any change to migration generation, snapshots, or existing CLI
  behavior.
- Writing wire protocols — drivers wrap existing client libraries.

## Decisions

- **Package map.** `@hejbro/query` (new, pure): compiler,
  driver-contract types, db handle types, generic RLS context mechanism.
  `@hejbro/pg` (new): vanilla TCP driver wrapping `pg`.
  `@hejbro/supabase`: adds its driver and `asUser`/`asAnon` context
  surface. `@hejbro/core`: additive-only — the v1 gaps in the existing
  query vocabulary (left join variant, returning column selection);
  no behavior change to existing declarations.
- **One shared vocabulary — no second statement IR** (D94 as amended
  during group 1, owner-settled 2026-08-26). Core already owns the
  statement nodes (`QueryNode`: select/insert/update/delete) and the
  `select`/`insert`/`update`/`deleteFrom` builders, because
  declarations contain queries (view bodies, function bodies, RLS
  `exists()`). Queries reuse that vocabulary unchanged; `@hejbro/query`
  owns the pure compiler, type inference, and execution. Boundary rule:
  the snapshot serializes only declaration-reachable nodes, so
  query-only constructs can never leak into snapshot format or
  migrations.
- **Literal handling differs by medium.** Declaration rendering keeps
  inlining literals (migration SQL must be readable/diffable); query
  compilation lifts runtime values to ordered bind parameters. The
  compiler, not call sites, owns parameter numbering, which is what
  makes `compile()` deterministic.
- **Compiler contract** (task 2.1, owner-settled 2026-08-26). `compile()`
  returns `{ sql, params, kind }`, `kind` being
  `"select" | "insert" | "update" | "delete"` — readonly types, no
  `Object.freeze`. Parameters are numbered `$1..$n` in render-appearance
  order, never de-duplicated. Every `LiteralNode` lifts to a bind
  parameter, with three fixed exceptions: `limit` renders inline (the
  builder already validates a non-negative integer), a `RawSqlNode`
  renders verbatim (user `sql.raw()` and the internal multi-row-insert
  `default` marker), and a `timestamp` literal renders
  `$n::timestamptz` carrying its ISO string. `null` and booleans are
  parameterized like any other literal, and an in-list stays
  `in ($1, $2, $3)` rather than `= any($1)`. Compilation is a lift
  pre-pass — walking projection → from → joins → where → orderBy and
  replacing each literal with its placeholder — followed by core's
  `renderQuery`, so query SQL and declaration SQL come from one
  renderer. Input is the structural union `{selectQuery}` /
  `{insertQuery}` / `{updateQuery}` / `{deleteQuery}` / `QueryNode`; the
  `sql` statement form joins it once task 2.6 is settled. The public
  signature is a single `compile(statement)` with no options. A statement
  built by the `sql` tag carries no `queryKind` to mirror, so `kind` takes
  a fifth value, `"sql"` — an unclassified tagged-template statement —
  and stays required and total rather than becoming optional or inferred
  by parsing the text (owner-settled 2026-08-26, resolving where the task
  2.1 and 2.6 decisions cross).
- **`sql` escape hatch contract** (task 2.6, owner-settled 2026-08-26).
  `@hejbro/query` does not define a second tagged template: its `sql` is a
  thin wrapper that delegates the fragment form to core's tag, so fragment
  semantics are identical by construction and core stays untouched. One
  tag serves both uses — it returns `Expr<"unknown"> & { statementExpr }`,
  usable anywhere an expression is and compilable as a statement, which is
  the single branch the `Compilable` union gains. `sql.identifier(...names)`
  quotes each part through core's identifier rule and joins them with `.`;
  interpolating a `Table` directly is deferred. `sql.raw` stays delegated
  and verbatim in both media, documented as the one injection point.
  Nested fragments rely on core's structural splicing, with parameter
  numbering following render order. Interpolation keeps core's
  `ambiguous-literal` rejection for arrays and plain objects in v1 — a
  query-side `param()` and jsonb branding are parked, not pre-empted here.
  Compiling a blank statement throws `empty-sql-statement`.
- **Security** (owner directive 2026-08-26). Injection safety is a spec
  requirement, not an implementation detail: no runtime value reaches the
  SQL text on any path, identifiers are always quoted through core's
  rule, and `sql.raw()` is the single documented verbatim path — each
  contract carried by an adversarial test, not only a happy-path one.
- **Capability-declaring drivers.** The contract lists capabilities as
  data (interactive transactions, session state, …). The query layer
  checks declarations up front and throws the explicit
  missing-capability error before any network send. No probing, no
  silent degradation.
- **RLS context = role + set_config list, transaction-wrapped.**
  Mechanism lives in `@hejbro/query`; context *types* come from presets
  (`asUser(jwt)`/`asAnon`) or the vanilla surface (role-based).
  `SET LOCAL` scope makes it pooling-safe by construction.
- **Types by inference, not generation.** Column-type → TS mapping is a
  type-level function over the declaration values; `jsonb` is `unknown`
  unless `$type`-branded. No codegen: an entire staleness failure class
  is rejected, at the cost of heavier type-level code (mitigated below).
- **Errors follow house style.** New packages throw enriched plain
  `Error`s with kebab-case codes (D57 tokens), not new classes;
  `HejbroError` is not extended to the new packages.

## Risks / Trade-offs

- [Type-level inference blows up tsc time or hits depth limits on wide
  schemas] → type tests ride each task (expect-type), measure on the
  examples' real schemas before archive; keep mapping tables flat, no
  distributive tricks where a lookup works.
- [Query-layer needs leak into core] → the §4.1-style genericity test
  repeats here: if `@hejbro/query` needs a core change, it must arrive
  through core's public surface, reviewed against the boundary rule.
- [Driver capability set proves too coarse for a future platform] →
  capabilities are additive data; a new key is a minor change, and the
  explicit-error rule means an old driver fails loudly, not wrongly.
- [RLS context correctness is security-sensitive] → the Supabase context
  scenario is verified against a real local stack (existing colima +
  `supabase start` flow) before the change archives, not only with unit
  fakes.
- [Two new published packages raise release surface] → both join the
  existing release automation; mechanics recorded as an open question,
  decided by the owner at release time.

## Migration Plan

Purely additive: two new packages plus preset additions; no existing
API, snapshot, or SQL output changes. Rollback = not publishing the new
packages. First release of the query layer is a `minor` (post-D83
policy).

## Open Questions

- Release mechanics for `@hejbro/query` and `@hejbro/pg`: whether they
  join the fixed version group in `.changeset/config.json`, and the
  first-version policy (start at the group's current version vs 0.x
  independent). Owner decides at the release gate; does not affect
  specs, approach, or tasks.
