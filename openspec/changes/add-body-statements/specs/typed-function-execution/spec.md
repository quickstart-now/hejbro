# typed-function-execution (delta)

## ADDED Requirements

### Requirement: A builder-declared return keeps its type at the call
A function whose `returns` is declared as a column builder SHALL resolve
at `db.fn` to that builder's own read type, derived the way a column's
read type is derived — not reconstructed from a narrowed type node.

Reconstruction is what would cost the typed call its precision: the
builder's type carries what the type node carries, so nothing has to be
rebuilt from a name.

#### Scenario: A builder-declared return infers its exact type
- **WHEN** a function declaring `returns` as a `varchar({ length })` or
  an enum builder is called through `db.fn`
- **THEN** the call's result type is that builder's read type, not a
  widened scalar union

### Requirement: The declared numeric mode is the mode the call returns
A scalar return declared with a numeric mode SHALL be materialized in
that mode. The conversion reads the declaration; it does not re-derive a
default from the type node.

Without this, a builder-declared return would type as its declared mode
and arrive in the default one — the type lying about the value, which is
the exact failure the builder form exists to avoid.

#### Scenario: A bigint return declared as number arrives as number
- **WHEN** a function declares `returns` as a `bigint` builder with mode
  `number` and is called through `db.fn`
- **THEN** the resolved value is a `number`, matching the call's static
  type
