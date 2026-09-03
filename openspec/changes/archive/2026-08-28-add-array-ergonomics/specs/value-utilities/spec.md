# value-utilities (delta)

## ADDED Requirements

### Requirement: assertNoNulls narrows a nullable-element array with a runtime check
The package SHALL export `assertNoNulls`, accepting a
`ReadonlyArray<T | null>` and returning it typed `ReadonlyArray<T>`.
The narrowing SHALL be runtime-checked: when any element is `null`, the
call SHALL throw an explicit error naming the first null element's
index — it SHALL never return a narrowed array that still contains
`null`, and it SHALL never drop elements (it is an assertion, not a
filter). The utility SHALL be importable from `@hejbro/core` and from
the `hejbro` facade.

#### Scenario: A clean array narrows in one call
- **WHEN** `assertNoNulls` is called on an array containing no `null`
  element
- **THEN** the same elements come back typed `ReadonlyArray<T>`, usable
  without per-site narrowing

#### Scenario: A null element fails fast, naming where
- **WHEN** `assertNoNulls` is called on an array whose element at index
  2 is `null`
- **THEN** the call throws an explicit error that names index 2, and no
  narrowed value is produced
