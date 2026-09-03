## ADDED Requirements

### Requirement: An argument name is a hejbro SQL name
`defineFunction` SHALL derive each argument's SQL name from its
declaration key exactly as a column's name is derived from its key, and
SHALL refuse at declaration time, with `invalid-sql-name`, a key whose
derived name is not a hejbro SQL identifier — naming the function, the
declared key and the derived name.

An argument name reaches the generated function unquoted, in the
parameter list and in every reference to it inside the body, so a name
that would need quoting produces SQL Postgres cannot parse. The
declaration is the last place that is cheap to say.

The reserved-word refusal is a separate rule with its own code
(`reserved-local-name`) and is unchanged: a derived name that is a valid
hejbro SQL name and a plpgsql reserved word still fails that way.

#### Scenario: An argument key whose derived name is not a hejbro SQL name is refused
- **WHEN** a function declares an argument under a key whose derived SQL
  name is not lower-case snake_case — a hyphen, a leading digit, an
  upper-case first letter, a space, a double quote, a non-ASCII letter,
  `__proto__`, or the empty string
- **THEN** the declaration fails with `invalid-sql-name`, naming the
  function, the declared key and the derived name, and no declaration is
  produced

#### Scenario: A camelCase key still declares a snake_case argument
- **WHEN** a function declares its arguments under ordinary camelCase
  keys
- **THEN** each argument's SQL name is that key's snake_case derivation,
  the body's argument reference renders that same name unquoted, and the
  declaration keeps naming the argument by its key

#### Scenario: A reserved word keeps its own refusal
- **WHEN** a function declares an argument whose derived name is a
  plpgsql reserved word
- **THEN** the declaration fails with `reserved-local-name`, not with the
  SQL-name refusal
