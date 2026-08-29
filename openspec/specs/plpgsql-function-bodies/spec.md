# plpgsql-function-bodies Specification

## Purpose

The plpgsql bodies hejbro generates for declared functions and
triggers: how a body's `ctx.return(...)` is checked against the
enclosing declaration's own return shape at declaration time, so a
body Postgres would reject at apply time — or only on the function's
first call — fails while the mistake is still cheap.

## Requirements

### Requirement: A body's return shape is decided by the declaration
`ctx.return(...)` SHALL accept exactly the shape the enclosing
declaration's own `returns` can carry, and SHALL reject any other shape
at declaration time with a named error rather than emitting SQL the
database refuses:

- `returns` a table (`returns setof …`) — a query; renders `return query …;`
- the trigger sentinel (`defineTrigger`) — a trigger row (`new`/`old`);
  renders `return <ref>;`
- `returns` a scalar type — an expression (a column reference, an
  argument reference, or a `sql` fragment); renders `return <expr>;`

A scalar-returning declaration whose body records no return at all SHALL
also fail at declaration time: Postgres accepts such a `CREATE` and
raises only when the function is first called, so the declaration is the
last place the mistake is cheap.

#### Scenario: A scalar function returns an expression
- **WHEN** a function declared with a scalar `returns` type returns an
  expression from its body
- **THEN** the generated function body carries `return <expr>;` and the
  function's `returns` clause is that scalar type

#### Scenario: A query returned from a scalar function is refused
- **WHEN** a function declared with a scalar `returns` type returns a
  query
- **THEN** the declaration fails with `scalar-return-expects-expression`,
  naming the expression forms it accepts — rather than emitting
  `return query …`, which Postgres rejects at apply time with "cannot use
  RETURN QUERY in a non-SETOF function"

#### Scenario: An expression returned from a setof or trigger body is refused
- **WHEN** a function returning `setof <table>`, or a trigger body,
  returns a scalar expression
- **THEN** the declaration fails with
  `scalar-return-in-non-scalar-function`, naming the shape that
  declaration does accept

#### Scenario: A scalar function that never returns is refused
- **WHEN** a function declared with a scalar `returns` type has a body
  that never calls `ctx.return(...)`
- **THEN** the declaration fails with `scalar-return-missing` rather than
  generating a function that raises "control reached end of function
  without RETURN" on its first call

### Requirement: Return-value dispatch is decided by brands, not property names
`ctx.return(...)` SHALL identify which of the three shapes it received by
each shape's own brand, never by probing for a property name a user's
declaration could also carry. A trigger row is recognized by its trigger
brand before any expression check runs, so a table with a column named
after an internal expression field (`exprNode`) SHALL still return the
trigger row as a row reference.

The shape errors this dispatch raises SHALL be unchanged: a trigger row
returned from a scalar-returning declaration still fails with
`scalar-return-expects-expression`, and an expression returned from a
setof or trigger body still fails with
`scalar-return-in-non-scalar-function`.

This is a requirement rather than an implementation note because the
failure it forbids depends on the user's own data: a table with a column
named after an internal field made `ctx.return(ctx.new)` mean something
different, for that user only. Written down, it also outlasts the fix —
a later refactor that reorders the dispatch has a requirement to fail
against, not just a test name.

#### Scenario: A column named like an internal field does not hijack dispatch
- **WHEN** a trigger body calls `ctx.return(ctx.new)` on a table that has
  a column named `exprNode`
- **THEN** the body renders `return new;` — the trigger row is recognized
  by its brand, not mistaken for an expression

#### Scenario: Shape errors survive the reordering
- **WHEN** a scalar-returning declaration returns a trigger row
- **THEN** it still fails with `scalar-return-expects-expression`
