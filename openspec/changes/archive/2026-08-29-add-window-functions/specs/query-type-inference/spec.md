# query-type-inference (delta)

## ADDED Requirements

### Requirement: A window function's result type is the type it really returns
A projected window function SHALL read back as the type Postgres actually
returns for it, and the runtime conversion SHALL deliver that type — the
rule aggregates already follow.

- `rowNumber()`/`rank()`/`denseRank()` SHALL type as `bigint` and SHALL be
  converted to one: Postgres returns `int8` for all three.
- `ntile(n)`/`percentRank()`/`cumeDist()` SHALL type as the numeric
  family's read type and need no conversion — `int4` and `float8` arrive
  as JavaScript numbers already.
- `lag`/`lead`/`firstValue`/`lastValue`/`nthValue` SHALL type as their
  argument does, which is what Postgres returns for them.
- A windowed aggregate SHALL keep the aggregate's own mapping: wrapping
  `count()` in `over()` SHALL NOT change what it reads back as, nor how it
  converts.

#### Scenario: rowNumber is a bigint end to end
- **WHEN** a select projects `over(rowNumber(), …)` and executes against a
  real database
- **THEN** the field's type is `bigint | null` and the value that arrives
  is a `bigint`, not the text the driver hands back for `int8`

#### Scenario: A windowed count converts like a count
- **WHEN** a select projects `over(count(), …)`
- **THEN** the field reads back exactly as an unwindowed `count()` does

#### Scenario: A value function keeps its argument's declared type
- **WHEN** a select projects `over(lag(column), …)` over a column declared
  with a numeric mode
- **THEN** the field's type is that column's own declared read type

### Requirement: A window-only call is not an expression
The eleven window-only constructors SHALL return a value that is not
assignable where an expression is required, so that omitting `over()`
fails to type-check rather than compiling into SQL Postgres rejects. As a
consequence, a window function SHALL NOT be expressible as an argument to
another function call.

#### Scenario: Forgetting over does not compile
- **WHEN** `rank()` is projected without `over()`
- **THEN** it fails to type-check

#### Scenario: Nesting a window function does not compile
- **WHEN** a window-only call is passed as an aggregate's argument
- **THEN** it fails to type-check, matching Postgres's prohibition on
  nesting
