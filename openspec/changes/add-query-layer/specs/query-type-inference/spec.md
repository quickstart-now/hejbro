# Delta: query-type-inference

## Purpose

Derives TypeScript result and input types for queries directly from the
schema declarations at the type level, so the declarations remain the
single source of truth and no generated files can go stale.

## ADDED Requirements

### Requirement: Result types are inferred from declarations
The result row type of a select or `returning` clause SHALL be inferred
from the declared column types of the projected columns, including
nullability: a column without `notNull` (and left-joined columns) SHALL
type as possibly `null`.

#### Scenario: Projection drives the row type
- **WHEN** a select projects a subset of a declared table's columns
- **THEN** the statement's result type contains exactly those column
  names with TypeScript types mapped from their declared SQL types

#### Scenario: Left join widens nullability
- **WHEN** a select left-joins a table and projects one of its `notNull`
  columns
- **THEN** that column types as its mapped type or `null` in the result

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require columns that are `notNull` without a
default or generated value and accept the rest as optional; update input
types SHALL accept any declared column as optional.

#### Scenario: Defaulted column is optional on insert
- **WHEN** a table declares a `notNull` column with a default and a
  plain `notNull` column
- **THEN** the insert input type requires the plain column and marks the
  defaulted column optional

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
