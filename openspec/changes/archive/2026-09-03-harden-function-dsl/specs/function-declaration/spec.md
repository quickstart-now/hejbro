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

One key never reaches that rule at all. A literal `__proto__:` key in an
object literal sets the object's prototype instead of defining a
property, so no argument is declared under it and there is no name to
validate — the function would silently take no argument. An `args`
object whose prototype is neither `Object.prototype` nor `null` SHALL
therefore be refused with `args-prototype-key`, naming the form that
does declare an argument. The same key written as a computed key is an
ordinary own property and is refused by the rule above, as its derived
name is not a hejbro SQL name.

#### Scenario: An argument key whose derived name is not a hejbro SQL name is refused
- **WHEN** a function declares an argument under a key whose derived SQL
  name is not lower-case snake_case — a hyphen, a leading digit, an
  upper-case first letter, a space, a double quote, a non-ASCII letter, a
  computed `__proto__` key, or the empty string
- **THEN** the declaration fails with `invalid-sql-name`, naming the
  function, the declared key and the derived name, and no declaration is
  produced

#### Scenario: A literal `__proto__` key is refused rather than silently dropped
- **WHEN** a function's `args` object is written with a literal
  `__proto__:` key, which replaces the object's prototype instead of
  declaring an argument
- **THEN** the declaration fails with `args-prototype-key`, naming the
  computed-key form that does declare an argument, and no declaration is
  produced — rather than a function that silently takes no argument

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
