# query-type-inference Specification

## Purpose

Derives TypeScript result and input types for queries directly from the
schema declarations at the type level, so the declarations remain the
single source of truth and no generated files can go stale.

## Requirements

### Requirement: Result types are inferred from declarations
The result row type of a select or `returning` clause SHALL be inferred
from the declared column types of the projected columns, including
nullability: a column without `notNull` SHALL type as possibly `null`.
A projection built from arbitrary expressions rather than a whole
declared table (an object projection, e.g. `select({a: expr}, table)`)
SHALL still key its result exactly to the projected names, but MAY
resolve each field's type only to its coarse SQL family widened to
nullable, rather than the full declared-column type — expressions
carry no link back to the declared column they read from (tracked as
**#311**), so a narrower type there would risk misrepresenting a value
this layer cannot actually verify.

#### Scenario: Projection drives the row type
- **WHEN** a select projects a subset of a declared table's columns
- **THEN** the statement's result type contains exactly those column
  names with TypeScript types mapped from their declared SQL types

#### Scenario: An object projection's field type is coarser than a whole-table projection's
- **WHEN** a select's projection is built from expressions rather than
  the whole declared table
- **THEN** the result type keys still match exactly what was projected,
  but each field's type reflects only its SQL family widened to
  nullable, not the full declared-column type (mode/array
  element/`$type` brand are not reflected)

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require columns that are `notNull` without a
default and accept the rest as optional; update input types SHALL accept
any declared column as optional.

#### Scenario: Defaulted column is optional on insert
- **WHEN** a table declares a `notNull` column with a default and a
  plain `notNull` column
- **THEN** the insert input type requires the plain column and marks the
  defaulted column optional

### Requirement: Numeric width mode decides the visible type, and never loses precision silently
A `bigint`/`numeric` column's declared mode SHALL decide the TypeScript
type it reads back as (`'bigint'`, `'number'`, or `'string'`), resolved
at declaration time rather than defaulted downstream. Converting a raw
value under `'number'` mode SHALL fail rather than silently return an
imprecise result when the value falls outside
`Number.MAX_SAFE_INTEGER`/`Number.MIN_SAFE_INTEGER`. Converting raw text
that is not parsable decimal numeric text — including an empty or
whitespace-only string — SHALL fail in every mode, rather than silently
returning a value (e.g. `0`/`0n`) indistinguishable from real data.

#### Scenario: Declared mode decides the result field's type
- **WHEN** a `bigint`/`numeric` column declares an explicit mode
- **THEN** the query result field's TypeScript type matches that mode
  (`bigint`, `number`, or `string`)

#### Scenario: Number mode rejects an unsafe value instead of losing precision
- **WHEN** a `'number'`-mode column's underlying value exceeds
  `Number.MAX_SAFE_INTEGER` (or is below `Number.MIN_SAFE_INTEGER`)
- **THEN** reading that value SHALL throw rather than return a value that
  has silently lost precision

#### Scenario: Unparsable or empty raw text is rejected in every mode
- **WHEN** a `bigint`/`numeric` column's raw driver text is not parsable
  decimal numeric text, including an empty or whitespace-only string
- **THEN** reading that value SHALL throw in `'string'`, `'number'`, and
  `'bigint'` mode alike, rather than returning `''`/`0`/`0n`

### Requirement: Interval columns surface as a structured value
An `interval` column SHALL surface as a structured TypeScript value, not
`unknown`. The value's fields SHALL map onto Postgres's own independent
storage axes (a whole-months count, a whole-days count, and a
sub-day duration with microsecond precision) without ever converting
between axes, since Postgres itself has no fixed ratio between them (a
month's day count varies). Reading an interval SHALL always produce a
fully normalized value — the same interval SHALL read back as the
identical value regardless of which axes its source text happened to
mention explicitly.

#### Scenario: Structured value, not unknown
- **WHEN** an `interval` column is projected
- **THEN** the result field's TypeScript type is a structured object, not
  `unknown`, and none of its fields is dropped or rounded away

### Requirement: `$type` narrows the visible type; jsonb is unknown unless branded
On any declared column, `.$type<T>()` SHALL only narrow the visible
TypeScript type — `T` MUST be a subset of the column's own base
TypeScript type, and a `T` that is not SHALL fail to type-check rather
than silently taking effect. A `json`/`jsonb` column SHALL surface as
`unknown` in query types unless the declaration opts in to a `$type`
brand, in which case the branded TypeScript type SHALL flow through
results and inputs unchanged.

#### Scenario: Opt-in brand flows through
- **WHEN** a `jsonb` column declares a `$type` brand and is projected
- **THEN** the result field has the branded type, and an unbranded
  `jsonb` column projected alongside it has type `unknown`

#### Scenario: A brand outside the column's base type is rejected
- **WHEN** a declaration calls `.$type<T>()` with a `T` that is not a
  subset of the column's own base TypeScript type (e.g. `integer()`,
  whose base type is `number`, with `.$type<string>()`)
- **THEN** the declaration fails to type-check

### Requirement: No generated type artifacts
Query typing SHALL work purely at the TypeScript type level from the
declaration values. The toolchain SHALL NOT generate `.d.ts` or any
other on-disk type artifacts for queries.

#### Scenario: Declaration edit is immediately visible
- **WHEN** a declared column's type changes in the schema source
- **THEN** dependent query result types change in the same type-check
  run with no generation step in between
