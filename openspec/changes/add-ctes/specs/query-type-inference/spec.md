# query-type-inference (delta)

## ADDED Requirements

### Requirement: A CTE reference carries its query's row type
A CTE reference SHALL expose one column per projected field of its own
query, named by that field's key, and typed as that field reads back —
including computed fields. A field projected as an aggregate or a window
function SHALL keep the read type its brand declares, so `over(rowNumber(),
…) as rn` is available outside the CTE as the same type it would have been
inside it.

A field the CTE does not project SHALL NOT be reachable through the
reference, even when the CTE's own source table declares it.

#### Scenario: A computed field is filtered on outside the CTE
- **WHEN** a CTE projects a window function under an alias and the body
  statement filters on that alias
- **THEN** the statement type-checks and the alias carries the window
  function's own read type

#### Scenario: An unprojected column is not reachable
- **WHEN** the body statement references a column of the CTE's source table
  that the CTE does not project
- **THEN** it does not type-check

### Requirement: A recursive term is typed from its anchor
The reference a recursive term is written against SHALL be typed from the
anchor term's projection. A recursive term whose projection does not match
the anchor's SHALL NOT type-check, matching Postgres's requirement that
both branches of the union agree.

#### Scenario: The recursive term sees the anchor's columns
- **WHEN** a recursive term is written inside the callback that receives
  the CTE's own reference
- **THEN** that reference's columns are the anchor term's projected fields,
  with the anchor's types

#### Scenario: A mismatched recursive term is refused
- **WHEN** a recursive term projects a different shape from the anchor
- **THEN** it does not type-check
