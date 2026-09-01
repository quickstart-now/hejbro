# query-type-inference (delta)

## REMOVED Requirements

### Requirement: No generated type artifacts
**D106 correction**: header changed from `### Removed:` to
`### Requirement:` — see `cli-commands/spec.md`'s own matching note;
same tool behavior, same fix.

**Ends, and is replaced by the requirement below.** It said query
typing works purely at the type level from declaration values, and that
the toolchain writes no on-disk type artifact for queries. The settled
design makes a committed, generated contract the way a consuming
repository learns its types, so the prohibition is not narrowed or
qualified — it no longer describes the product.

Its reasoning is preserved where it still holds: a repository that
**owns** its schema still queries through its declarations, with no
generation step between editing one and seeing the type change.

## ADDED Requirements

### Requirement: A repository's own declarations still type its queries directly
In the repository that declares a schema, query types SHALL come from
the declarations at the type level, with no generated artifact between
them. Editing a declared column's type SHALL change dependent query
types in the same type-check run.

**Observer (D106 m8)**: this scenario is structural — `@hejbro/query`'s
own chain and `SelectResult` machinery compute a query's result type
directly from a `Table` value at compile time, with no intermediate
codegen step to short-circuit; it is carried forward from the removed
requirement this one replaces, whose own extensive suite already
exercises it (`packages/query/test/types/**`). Restated here as this
requirement's own scenario, not a fresh claim.

#### Scenario: Declaration edit is immediately visible
- **WHEN** a declared column's type changes in the schema source
- **THEN** dependent query result types change in the same type-check
  run with no generation step in between

### Requirement: A consuming repository's types come from a committed contract
A repository that does not own the schema SHALL obtain its types from a
generated contract committed to that repository, and querying through
it SHALL produce the same types the owning repository sees.

The contract is generated, committed, and reviewed as a diff. That is
the point rather than a cost: a type that changes because someone
edited a schema elsewhere becomes a reviewable line in a pull request
instead of an invisible shift at the end of an inference chain.

#### Scenario: A vendored contract types a query
- **WHEN** a query is written against a vendored contract
- **THEN** its result type matches what the same query yields against
  the owning repository's declarations
- **Observer (D106 m8)**: `examples/cli-smoke`'s own
  `vendored-contract.test.ts` — a local `db()` handle and a vendored
  `createDb()` handle, built from the same declarations, compiled
  together by one real `tsc` with a type-level equality assertion that
  fails to compile if the two `select()` result types disagree. Member-
  by-member coverage (`contract-types.test.ts`) and SQL-identity
  coverage (`parity.test.ts`) existed before this; this is the missing
  type-level comparison of the two paths' actual result types.

#### Scenario: A schema change arrives as a diff
- **WHEN** the source schema changes and the consumer vendors it
- **THEN** the change appears as a modification to committed files
- **Observer**: this scenario's own witness — a live loop where a
  schema change is vendored and observed as a diff — rides with #603
  (the apply-engine change), the same relocation R2-G9's own header
  records for the two-repository witness as a whole. No test in this
  change asserts it directly yet.
