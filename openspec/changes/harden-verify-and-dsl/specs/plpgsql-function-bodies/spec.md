## ADDED Requirements

### Requirement: A projected returning is a returnable query
`ctx.return` SHALL accept a mutation whose chain ends in `.returning()`
with a projection, exactly as it accepts the bare `.returning()` form:
the projected columns become the function's result and the rendered body
carries the same `RETURNING` list the query builder renders elsewhere.

#### Scenario: A projected returning is returned as the body's result
- **WHEN** a body returns `insert(p).values(r).returning({ id: p.id })`
- **THEN** the declaration compiles, and the rendered body returns the
  projected column
