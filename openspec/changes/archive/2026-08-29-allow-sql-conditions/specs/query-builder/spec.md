# query-builder (delta)

## MODIFIED Requirements

### Requirement: Condition expressions reuse the declaration vocabulary
Query conditions SHALL be built from the same expression helpers the
schema DSL uses (the core ExprNode vocabulary), so an expression valid
in a declaration is valid in a query. Every condition position — select
`where`, join `on`, update `where`, delete `where`, and the `related()`
chain's `where` — SHALL accept the same `Expr<"boolean"> |
Expr<"unknown">` union the declaration-side condition positions accept
(`check()`, partial-index `.where()`, RLS policy `using`/`withCheck`),
so a `sql` fragment, whose family cannot be narrowed at compile time,
needs no cast to be used as a condition.

#### Scenario: Declaration helper used in a query filter
- **WHEN** a `where` condition is built with an existing expression
  helper (for example an equality over a declared column)
- **THEN** it compiles to the same SQL text that helper renders in
  declaration contexts, with literal values lifted to bind parameters

#### Scenario: A lifted timestamp keeps its type context
- **WHEN** a condition or written value carries a timestamp literal, which
  a declaration would render as a cast string literal
- **THEN** the compiled SQL carries the placeholder with the same cast
  and the parameter is the ISO-8601 string, so the value's type is fixed
  by the statement rather than by driver-specific encoding

#### Scenario: A sql fragment is a condition wherever a declaration accepts one
- **WHEN** a `sql` fragment expressing a predicate the typed operators
  cannot build (a function call over a column compared to a value) is
  passed to a select `where`, a join `on`, or an update or delete
  `where`
- **THEN** it type-checks without a cast and compiles into the
  statement's condition position with its interpolated values as bind
  parameters

#### Scenario: A fragment condition composes with typed operators
- **WHEN** a `sql` fragment is combined with an operator-built condition
  through `and`/`or`
- **THEN** the combination type-checks and compiles as one condition
  tree, in the order written

### Requirement: Typed sql escape hatch
The query package SHALL provide a typed `sql` tagged template usable as
a statement or embedded as an expression fragment. Interpolated values
SHALL become bind parameters, never inlined literals; interpolated
fragments and identifiers compose structurally. A fragment SHALL be
usable in every position a statement admits an expression — projection,
written value, and condition alike — so the escape hatch has no position
it cannot reach.

The same fragment is medium-dependent by design: written into a
declaration it renders its interpolated values as quoted inline literals,
because migration SQL has to stay readable and diffable; compiled as part
of a query it lifts those same values to bind parameters. `sql.raw()` is
verbatim in both media.

#### Scenario: Escape hatch parameterizes interpolations
- **WHEN** a `sql` template interpolates a runtime value
- **THEN** the compiled SQL contains a parameter placeholder for it and
  the value appears only in the parameter list
