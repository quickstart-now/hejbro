# query-execution (delta)

## ADDED Requirements

### Requirement: The chain declares CTEs too
The chain surface SHALL offer `with()` as its own root, producing the same
statement node the core builder produces for the same declaration, and
SHALL execute it as one statement.

Result rows SHALL be converted by the body statement's own projection: a
statement wrapped in a `WITH` reads back exactly as the same body would
without one, brands and conversions included.

#### Scenario: A chain-built CTE compiles like the builder's
- **WHEN** the same CTE statement is expressed through the chain and
  through the core builder
- **THEN** the two compile to byte-identical SQL and the same parameter
  order

#### Scenario: Results convert through the wrapper
- **WHEN** a statement declaring a CTE projects a field whose type needs
  conversion
- **THEN** the value arrives converted, as it would in an unwrapped
  statement
