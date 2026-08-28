# query-execution (delta)

## ADDED Requirements

### Requirement: Set-operation results convert per the left branch
Executing a set-operation statement SHALL deliver rows converted
exactly as a select over the LEFT branch would convert them — declared
keys, numeric modes, intervals, arrays, the whole existing conversion
contract — in one statement and one round trip, under an RLS execution
context exactly like any other statement.

#### Scenario: Converted values arrive through a union
- **WHEN** a union over tables declaring a `bigint` and an `interval`
  column executes against a real database
- **THEN** every delivered row carries `bigint` values as `bigint` and
  interval values structured, exactly as the single-select read does
