# plpgsql-function-bodies Delta

## ADDED Requirements

### Requirement: A scalar return expression's family is checked against the declaration
`ctx.return(<expr>)` in a scalar-returning declaration SHALL compare the
expression's type family against the declared `returns` type's family at
declaration time, and SHALL fail with `scalar-return-family-mismatch` —
naming both families in its `Next:` — exactly when the pair is one whose
plpgsql `RETURN` coercion fails for every value: Postgres accepts the
`CREATE` and every call of such a function then fails to convert the
returned value.

hejbro SHALL NOT become stricter than Postgres. A pair Postgres accepts
for some values SHALL stay accepted (`20260101` is a valid ISO date, so
a numeric expression may be returned as a datetime; `{}` prints as both
an empty JSON object and an empty array literal; inet input accepts
partial addresses like `42.5`). An expression of unknown family (a `sql`
fragment) SHALL never be refused, a same-family pair SHALL never be
refused, and a declaration whose `returns` family is text or bytea SHALL
never refuse — both accept every family through Postgres's IO
conversion (an enum return, though text-family, accepts only its own
labels; it stays unrefused on the safe side rather than by that
argument).

The check is family-granular by construction: an expression carries only
its coarse type family, so a within-family mismatch (`returns: time()`
returning a date column) is outside this check's reach and remains a
first-call failure. The boundary is the type information the expression
itself carries.

#### Scenario: A uuid expression returned as integer is refused
- **WHEN** a function declared with `returns: integer()` returns a
  uuid-family expression from its body
- **THEN** the declaration fails with `scalar-return-family-mismatch`,
  naming the returned family (uuid) and the declared family (numeric) —
  rather than generating a function whose every call fails to convert
  the value

#### Scenario: A value-dependent pair is not refused
- **WHEN** a function declared with a datetime `returns` type returns a
  numeric expression
- **THEN** the declaration succeeds — Postgres accepts some numeric
  values there, and hejbro does not refuse what Postgres might accept

#### Scenario: A sql fragment return is never family-checked
- **WHEN** a scalar-returning declaration returns a `sql` fragment
- **THEN** the declaration succeeds regardless of the declared family —
  an unknown-family expression makes no claim to check

#### Scenario: A text-returning declaration accepts every family
- **WHEN** a function declared with `returns: text()` returns a
  boolean-family expression
- **THEN** the declaration succeeds — every family reaches text through
  IO conversion
