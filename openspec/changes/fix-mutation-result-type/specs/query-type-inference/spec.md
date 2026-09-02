# Delta: query-type-inference

## ADDED Requirements

### Requirement: A mutation without returning resolves to no rows
An `insert`, `update`, or `delete` chain that never calls `returning()`
SHALL resolve, when awaited or executed, to `ReadonlyArray<never>` — the
empty array the statement actually produces, typed so that reading a
column off an element is a compile-time error. (An explicitly annotated
destination of a row-array type still accepts the empty array; `never`
is the bottom type and no inhabited alternative would be more honest.)
The rendered SQL carries no `returning` clause in that case and never
will implicitly. Calling `returning()` with no projection SHALL keep
resolving every declared column, and calling it with a projection SHALL
keep resolving exactly the projected keys.

The marker lives on the stage a chain sits at before `returning()` is
called, not on the bare exported names: `InsertFinal<T>`,
`UpdateFinal<T>`, `DeleteFinal<T>`, their `*ChainFinal` counterparts and
`ReturningRow<T>` written with one type argument SHALL keep meaning
"every declared column", exactly as before, so code that names a stage
by its bare type keeps compiling and keeps accepting stages that
requested a projection or no projection. Only the pre-`returning()`
stage types (`InsertReturnable`/`InsertConflictable`, `UpdateReturnable`/
`UpdateFilterable`, `DeleteReturnable`/`DeleteFilterable`, and their chain
counterparts) carry the never-requested instantiation, and that
instantiation is assignable wherever the bare name is accepted.

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

#### Scenario: A bare stage name keeps its meaning
- **WHEN** a stage that called `returning()` — with or without a
  projection — is passed where a bare `InsertFinal<T>` (or the update or
  delete equivalent) is expected, or a pre-`returning()` stage is
- **THEN** it compiles as it did before this requirement; the bare name
  accepts every instantiation it accepted

#### Scenario: Update and delete follow the same rule
- **WHEN** an `update` or `delete` chain is awaited without `returning()`
- **THEN** it resolves to `ReadonlyArray<never>` by the same mechanism,
  not by a separate copy of the rule
