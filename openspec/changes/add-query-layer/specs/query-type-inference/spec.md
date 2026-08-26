# Delta: query-type-inference

## Purpose

Derives TypeScript result and input types for queries directly from the
schema declarations at the type level, so the declarations remain the
single source of truth and no generated files can go stale.

## ADDED Requirements

### Requirement: Result types are inferred from declarations
The result row type of a select or `returning` clause SHALL be inferred
from the declared column types of the projected columns, including
nullability: a column without `notNull` SHALL type as possibly `null`.

#### Scenario: Projection drives the row type
- **WHEN** a select projects a subset of a declared table's columns
- **THEN** the statement's result type contains exactly those column
  names with TypeScript types mapped from their declared SQL types

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
`Number.MAX_SAFE_INTEGER`/`Number.MIN_SAFE_INTEGER`.

#### Scenario: Declared mode decides the result field's type
- **WHEN** a `bigint`/`numeric` column declares an explicit mode
- **THEN** the query result field's TypeScript type matches that mode
  (`bigint`, `number`, or `string`)

#### Scenario: Number mode rejects an unsafe value instead of losing precision
- **WHEN** a `'number'`-mode column's underlying value exceeds
  `Number.MAX_SAFE_INTEGER` (or is below `Number.MIN_SAFE_INTEGER`)
- **THEN** reading that value SHALL throw rather than return a value that
  has silently lost precision

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

### Requirement: jsonb is unknown unless branded
A `jsonb` column SHALL surface as `unknown` in query types unless the
declaration opts in to a `$type` brand, in which case the branded
TypeScript type SHALL flow through results and inputs unchanged.

#### Scenario: Opt-in brand flows through
- **WHEN** a `jsonb` column declares a `$type` brand and is projected
- **THEN** the result field has the branded type, and an unbranded
  `jsonb` column projected alongside it has type `unknown`

### Requirement: No generated type artifacts
Query typing SHALL work purely at the TypeScript type level from the
declaration values. The toolchain SHALL NOT generate `.d.ts` or any
other on-disk type artifacts for queries.

#### Scenario: Declaration edit is immediately visible
- **WHEN** a declared column's type changes in the schema source
- **THEN** dependent query result types change in the same type-check
  run with no generation step in between
