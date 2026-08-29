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

"Match" here means **the same key set**, and a column's type is the union
of the two branches' — the same rule a set operation already uses, because
a recursive CTE *is* an anchor and a recursive term joined by `UNION`.
Requiring the two projections to be identical would be stricter than that
rule and would reject the constructs Postgres accepts in a recursive term:
a field the anchor reads straight from a column and the recursive term
computes with a window function or an aggregate has a different type on
each side and is legal on both.

This check holds in the core builder, where the recursive term is written.
A plain `union()` in the core builder does **not** carry it today — that
rule has only ever been wired into the chain surface — so a mismatched
plain union still builds and fails on the server. That gap is #487's, not
this change's: the compatibility type moves into core here, which is most
of what closing it needs, but wiring it into `union()` changes a surface
D103 settled and belongs to its own change.

#### Scenario: The recursive term sees the anchor's columns
- **WHEN** a recursive term is written inside the callback that receives
  the CTE's own reference
- **THEN** that reference's columns are the anchor term's projected fields,
  with the anchor's types

#### Scenario: A recursive term missing one of the anchor's keys is refused
- **WHEN** a recursive term projects a different key set from the anchor
- **THEN** it does not type-check

#### Scenario: A field computed differently on each side is accepted
- **WHEN** the anchor projects a column directly and the recursive term
  projects the same key through a window function
- **THEN** it type-checks, and the field's type is the union of the two —
  the rule a set operation already applies to its branches
