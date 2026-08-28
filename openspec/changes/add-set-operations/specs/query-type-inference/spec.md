# query-type-inference (delta)

## ADDED Requirements

### Requirement: Set-operation branches must be row-compatible, and the result types honestly
A set-operation combinator SHALL fail to type-check when the two
branches' result rows carry different key sets — the database would
reject the statement, so the program does first. The combined result
row SHALL take the LEFT branch's keys (SQL's own naming rule); each
column's type SHALL be the union of the two branches' declared read
types for that key (identical declarations stay unchanged), and a
column nullable in EITHER branch SHALL be nullable in the result.

#### Scenario: Identical branch shapes pass through unchanged
- **WHEN** two whole-table selects over identically-declared tables
  combine with `.union(...)`
- **THEN** the awaited row type equals the single-select row type

#### Scenario: Mismatched keys are rejected at compile time
- **WHEN** a select over `{ id, name }` unions a select over
  `{ id, title }`
- **THEN** the program fails to type-check rather than compiling a
  statement the database would reject

#### Scenario: Nullability widens to the union
- **WHEN** a branch with a `notNull` column unions a branch where the
  same key is nullable
- **THEN** the result types that column as nullable
