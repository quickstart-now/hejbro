# Delta: query-type-inference

## ADDED Requirements

### Requirement: A mutation without returning resolves to no rows
An `insert`, `update`, or `delete` chain that never calls `returning()`
SHALL resolve, when awaited or executed, to a type that cannot be read
as rows — the empty array the statement actually produces, typed as
`ReadonlyArray<never>`. The rendered SQL carries no `returning` clause
in that case and never will implicitly; the type SHALL say so rather
than promise the declared row shape. Calling `returning()` with no
projection SHALL keep resolving every declared column, and calling it
with a projection SHALL keep resolving exactly the projected keys. The
only case that changes is the one where nothing was requested.

#### Scenario: An insert without returning promises no rows
- **WHEN** a mutation chain is awaited without `returning()` having been
  called
- **THEN** its resolved element type is `never` — reading a column off
  an element is a compile-time error, and the awaited value is an empty
  array at runtime

#### Scenario: Returning without a projection is unchanged
- **WHEN** the same chain calls `returning()` with no argument before
  it is awaited
- **THEN** it resolves to every declared column of the table, typed as
  declared, exactly as before this requirement

#### Scenario: Update and delete follow the same rule
- **WHEN** an `update` or `delete` chain is awaited without `returning()`
- **THEN** it resolves to `ReadonlyArray<never>` by the same mechanism,
  not by a separate copy of the rule
