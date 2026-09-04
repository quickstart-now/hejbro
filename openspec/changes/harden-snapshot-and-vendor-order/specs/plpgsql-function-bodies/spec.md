## ADDED Requirements

### Requirement: A setof body returns the declared table's whole row
Under `returns setof <table>`, `ctx.return(...)` SHALL accept only a
query whose rows are that table's whole row: a select of that table
(`select(<table>)…`, joins and conditions allowed), or an insert, update
or delete on that table whose chain ends in a bare `.returning()`. It
SHALL refuse, at declaration time and with a named error whose `Next:`
clause names those two forms, a query whose projection is anything else
— a projected `.returning({ … })`, a select with a column projection, or
a query whose row source is another table — even when the projection
lists every column.

The rendered `return query …` carries the whole row in the table's
physical column order, so the function's result rows are exactly the
rows Postgres expects for `returns setof <table>`. Postgres matches those
rows positionally, by count and type, names ignored: a narrower
projection is accepted at `CREATE` and fails on the first call, and a
complete projection in another order with coincident types is accepted
and silently wrong. The declaration is the only place either is visible.

The accepted type narrows to match: a projected returning is not
assignable to `ctx.return` in the type it takes, and a caller reaching
the recorder with the type bypassed is refused with the same error. The
refusal runs after the returning-stage check and before anything is
recorded: a mutation with no `.returning()` still fails with
`return-expects-returning` first.

#### Scenario: A projected returning under setof is refused
- **WHEN** the body of a function returning `setof <table>` returns an
  insert, update or delete on that table whose chain ends in
  `.returning({ … })` — one column, several, every column, every column
  in another order, or an aliased column
- **THEN** the declaration fails with the named error, and no declaration
  is produced

#### Scenario: A projected select under setof is refused
- **WHEN** such a body returns a select with a column projection over
  that table, or any select whose row source is another table
- **THEN** the declaration fails with the same named error

#### Scenario: The whole-row forms are accepted and render in physical order
- **WHEN** such a body returns `select(<table>)` — with or without a
  join or a condition — or a mutation on that table ending in a bare
  `.returning()`
- **THEN** the declaration succeeds and the body renders `return query
  …;` listing the table's columns in physical order

#### Scenario: The returning-stage refusal comes first
- **WHEN** such a body returns a mutation that never called
  `.returning()`, with the type bypassed
- **THEN** it fails with `return-expects-returning`, not with the
  whole-row error

## MODIFIED Requirements

### Requirement: A returned mutation carries a returning clause
`ctx.return(...)` SHALL accept a mutation only when its chain ends in a
bare `.returning()` and SHALL refuse one that does not: in the type it
accepts, and, for a caller that reaches it with the type bypassed, at
declaration time with `return-expects-returning`. That declaration-time
refusal is reached only by a `setof <table>` body: a scalar body fails
earlier with `scalar-return-expects-expression` and a trigger body with
`trigger-return-expects-row`, in that fixed order.

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
- **WHEN** such a body returns an insert, an update or a delete on the
  declared table ending in a bare `.returning()`
- **THEN** the declaration compiles and the body renders
  `return query <sql>;`, carrying that statement's own whole-row
  `RETURNING` list

#### Scenario: An executed mutation is unaffected
- **WHEN** a body executes a mutation that never called `.returning()`
  through `ctx.execute`
- **THEN** the declaration compiles and the statement renders for its
  effect — what `ctx.execute` accepts is not narrowed by this rule

## REMOVED Requirements

### Requirement: A projected returning is a returnable query
**Reason**: a projected `RETURNING` list is never the row shape a
`returns setof <table>` function yields, and trigger and scalar bodies
refuse every query already, so the form had no declaration it was valid
in; Postgres accepts the `CREATE` and fails the first call.
**Migration**: return the whole row — `select(<table>)…` or a mutation
on that table ending in a bare `.returning()`; a function whose result
is a narrower shape declares that shape as its `returns` instead.
