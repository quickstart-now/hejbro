# query-type-inference (delta)

## MODIFIED Requirements

### Requirement: No generated type artifacts
Query typing SHALL work purely at the TypeScript type level from the
declaration values. The toolchain SHALL NOT generate `.d.ts` or any
other on-disk type artifacts for queries.

A schema module written for a repository that queries a schema it does
not own is not such an artifact: it declares runtime values, and query
types are inferred from those values exactly as they are inferred from
hand-written declarations. What that module may contain, when it is
written, and how its staleness is detected are stated by the
`schema-manifest` and `schema-sync` capabilities.

#### Scenario: Declaration edit is immediately visible
- **WHEN** a declared column's type changes in the schema source
- **THEN** dependent query result types change in the same type-check
  run with no generation step in between

#### Scenario: A synced module infers rather than declares types
- **WHEN** a query is written against a module obtained from a database
- **THEN** its result types come from the module's values in the same
  type-check run, and no type artifact accompanies the module
