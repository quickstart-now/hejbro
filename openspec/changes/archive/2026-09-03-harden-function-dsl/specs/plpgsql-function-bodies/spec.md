## ADDED Requirements

### Requirement: A returned mutation carries a returning clause
`ctx.return(...)` SHALL accept a mutation only when its chain ends in
`.returning()` — bare or projected — and SHALL refuse one that does not:
in the type it accepts, and, for a caller that reaches it with the type
bypassed, at declaration time with `return-expects-returning`. That
declaration-time refusal is reached only by a `setof <table>` body: a
scalar body fails earlier with `scalar-return-expects-expression` and a
trigger body with `trigger-return-expects-row`, in that fixed order.

A body's `return query …` needs a command that produces rows. A mutation
with no `RETURNING` clause produces none: Postgres accepts the function
at creation and rejects the body only when it is called (`INSERT query
does not return tuples`) — the declaration is the earliest place the
mistake can be named.

This is the mirror of the rule `ctx.execute` already carries: the
returning form is `ctx.return`'s, the non-returning form is
`ctx.execute`'s, and each refuses the other's. `ctx.execute` keeps
accepting a mutation at either stage, and keeps refusing the one that
carries `.returning()` with its own error.

#### Scenario: A mutation with no returning cannot be returned
- **WHEN** the body of a function returning `setof <table>` returns an
  insert, an update or a delete whose chain does not end in
  `.returning()`
- **THEN** the declaration does not type-check, and a caller reaching the
  recorder with the type bypassed fails with `return-expects-returning`,
  naming the statement kind and both forms that work — add `.returning()`
  when the rows are the function's result, or run the statement with
  `ctx.execute` for its effect

#### Scenario: A returning mutation is returned as before
- **WHEN** such a body returns an insert, an update or a delete ending in
  `.returning()`, bare or projected
- **THEN** the declaration compiles and the body renders
  `return query <sql>;`, carrying that statement's own `RETURNING` list

#### Scenario: An executed mutation is unaffected
- **WHEN** a body executes a mutation that never called `.returning()`
  through `ctx.execute`
- **THEN** the declaration compiles and the statement renders for its
  effect — what `ctx.execute` accepts is not narrowed by this rule
