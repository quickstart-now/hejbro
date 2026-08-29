# plpgsql-function-bodies (delta)

## ADDED Requirements

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
