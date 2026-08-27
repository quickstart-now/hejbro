# table-declaration (delta)

## ADDED Requirements

### Requirement: Non-null array elements are declared, and the constraint backs the claim
An array column SHALL be declarable as holding no `NULL` elements via
`.array().notNullElements()`. Declaring it SHALL add a CHECK constraint
to the table's generated migration, named `<column>_no_null_elements`
(the SQL column name, snake_case) with the expression
`array_position("<column>", null) is null` — the database enforces
exactly what the narrowed type claims, so the narrowing is never an
unchecked assertion. The constraint SHALL participate in
diffing/removal exactly as a hand-declared check does: removing the
declaration (or the column) drops it, and a name collision with a
hand-declared check of the same name SHALL fail declaration loudly.
Calling `notNullElements()` on a non-array column SHALL fail fast at
declaration time with an explicit error naming the column, never
silently no-op.

#### Scenario: Declaring notNullElements emits the backing check
- **WHEN** a table declares `tags: text().array().notNullElements()`
- **THEN** the generated migration for that table contains a CHECK
  constraint named `tags_no_null_elements` with the expression
  `array_position("tags", null) is null`

#### Scenario: Removing the declaration drops the check
- **WHEN** a previously generated `notNullElements` declaration is
  removed while the column stays
- **THEN** the next migration drops the `<column>_no_null_elements`
  check, exactly as removing a hand-declared check would

#### Scenario: Misuse on a non-array column fails fast
- **WHEN** `notNullElements()` is called on a column that is not an
  `.array()` column
- **THEN** declaration fails with an explicit error naming the column,
  never a silently ignored call
