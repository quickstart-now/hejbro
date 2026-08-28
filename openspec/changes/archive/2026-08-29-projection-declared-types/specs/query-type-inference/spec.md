# query-type-inference (delta)

## MODIFIED Requirements

### Requirement: Result types are inferred from declarations
The result row type of a select or `returning` clause SHALL be inferred
from the declared column types of the projected columns, including
nullability: a column without `notNull` SHALL type as possibly `null`.
An array column's element type SHALL include `| null` — Postgres arrays
are element-nullable regardless of the column's own `notNull`, and the
runtime delivers a `NULL` element as `null` — except a column declared
`.notNullElements()`, whose element type SHALL be the bare element type
(the emitted CHECK backs the claim).

A projection built from expressions rather than a whole declared table
(an object projection, e.g. `select({a: expr}, table)`) SHALL still key
its result exactly to the projected names. A field projecting a
**declared column** SHALL carry that column's full declared read type —
numeric mode, array element type, and the `$type` brand included —
recovered from the column reference's own declaration link, never from a
name match against the source table. A field projecting anything else
SHALL resolve to its SQL family widened to nullable, which is all such a
value carries.

Every object-projection field SHALL type as possibly `null` regardless
of the source column's `notNull`: the projection's type is fixed before
a left join can be chained onto it, so a left join can null any of them,
and this layer cannot yet see which tables were left-joined (tracked as
**#307**). Whole-table projections and `returning()` without a
projection are unaffected and carry declared nullability.

#### Scenario: Projection drives the row type
- **WHEN** a select projects a subset of a declared table's columns
- **THEN** the statement's result type contains exactly those column
  names with TypeScript types mapped from their declared SQL types

#### Scenario: A projected declared column keeps its declared type
- **WHEN** a select projects a declared `bigint({ mode: "bigint" })`
  column, a `jsonb().$type<T>()` column, or an array column under an
  alias
- **THEN** the field reads back as `bigint`, `T`, and the declared
  element array respectively — not the family-wide union — and the
  conversion the runtime applies to that field is the same declared
  column's conversion

#### Scenario: A computed expression resolves only to its family
- **WHEN** a select projects a `sql` fragment or another expression that
  is not a declared column reference
- **THEN** the field's type is that expression's SQL family widened to
  nullable

#### Scenario: Object-projection fields stay nullable
- **WHEN** a select projects a `notNull` declared column under an alias
- **THEN** the field still types as possibly `null`, because a later
  `.leftJoin()` on the same statement can null it

#### Scenario: Array element nullability follows the declaration
- **WHEN** a table declares `tags: text().array()` and
  `labels: text().array().notNullElements()`
- **THEN** a whole-table select's row type reads `tags` with elements
  typed `string | null` and `labels` with elements typed `string`
