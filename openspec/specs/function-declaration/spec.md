# function-declaration Specification

## Purpose

Defines `defineFunction`'s declaration surface — what the `args` and
`returns` declarations promise about the emitted function and about the
types a caller sees. First populated by add-body-statements (#433's
returns-accepts-a-builder); grows as later changes touch more of the
declaration surface.

## Requirements

### Requirement: A return type is declared the way an argument type is
`defineFunction`'s `returns` SHALL accept a column builder wherever it
accepts a type node, matching what `args` already accepts, and the
declared return SHALL keep everything the builder carries — a `varchar`'s
length, an enum's schema and name, an array's element type, a numeric
mode.

The builder is not normalized into a narrower node. The declaration keeps
the builder itself, because the two cheaper forms each break something:
reducing it to a type name would make the declared type disagree with the
type the database gets, and widening the declaration's return to a bare
type node would collapse every scalar function's call result to the union
of all scalar types.

The type node form stays exactly as it is; the builder form is additive.

#### Scenario: A parameterized type declared as a builder keeps its detail
- **WHEN** a function declares `returns` as a column builder carrying a
  length, an enum identity or an array element type
- **THEN** the generated `returns` clause is that full type — the same
  clause the equivalent type node would have produced

#### Scenario: A type node stays a valid return declaration
- **WHEN** a function declares `returns` as a type node
- **THEN** the declaration behaves exactly as before

### Requirement: A return declaration carries no narrowing it cannot back
A column builder's narrowing is honored at a `returns` position only when
the declaration itself enforces it. `notNullElements()` narrows an
array's elements to exclude `null` and is backed, on a column, by the
check constraint the table derives; a function's `returns` clause derives
no constraint at all, so the same builder at a `returns` position SHALL
be refused rather than promising a shape nothing enforces.

#### Scenario: A returns builder with unbacked element narrowing is refused
- **WHEN** a function declares `returns` as an array builder carrying
  `notNullElements()`
- **THEN** the declaration fails, naming the plain array builder as the
  form that says what the function actually guarantees

### Requirement: A synthesized function declaration is refused by generate
A function declaration carrying usage authority — one synthesized from a
vendored contract rather than written in a declaration module — SHALL be
refused by `generate` with `synced-function-declared`, the function-side
twin of the table guard, so a consumer never migrates from a description
it does not own. A declaration written with `defineFunction` or
synthesized by a trigger definition carries no such authority and is
never touched by this guard.

#### Scenario: A usage-authority function reaching generate is refused
- **WHEN** a function declaration tagged with usage authority is passed to
  `generateMigration`
- **THEN** it fails with `synced-function-declared`, naming the function
  and the way forward, and no migration is produced

#### Scenario: Ordinary declarations are untouched
- **WHEN** a schema whose functions come from `defineFunction` and trigger
  definitions is generated
- **THEN** the guard never fires

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
