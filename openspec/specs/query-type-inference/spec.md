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

### Requirement: Insert and update input types follow the declaration
Insert input types SHALL require every `notNull` column without a default
and accept the rest as optional; update input types SHALL accept every
column as optional. Each column's accepted value type SHALL be its own
declared read type, so a value the column could never read back is not a
value it accepts:

- a `bigint`/`numeric` column accepts exactly what its resolved mode
  reads back as, never a sibling mode's shape
- an `interval` column accepts a structured interval value
- a `date`/`timestamp`/`timestamptz` column accepts exactly `Date`
- a `json`/`jsonb` column accepts any JSON-serializable value, which the
  query layer serializes; the column's declared type — `json` or `jsonb`
  — SHALL decide the cast, so a `json` column is never written through a
  `jsonb` cast and never acquires jsonb's key reordering
- a `bytea` column accepts a `Uint8Array`, which the query layer
  hex-encodes; a string SHALL NOT be accepted, because its encoding would
  have to be guessed
- an array column whose element type is `json`, `jsonb` or `bytea` SHALL
  accept only an `Expr`: those element types need their own array-literal
  escaping rules

A `.$type<T>()` brand SHALL narrow the write type as well as the read
type — a branded column accepts `T` and nothing wider.

Every column SHALL additionally accept an `Expr` (the `sql` escape
hatch), and a written value SHALL reach the database as a bind parameter,
never as text spliced into the statement.

#### Scenario: Insert input requires what the declaration requires
- **WHEN** a table declares a `notNull` column without a default
- **THEN** that key is required on the insert input type, and optional on
  the update input type

#### Scenario: A json value is written without hand-serialization
- **WHEN** an insert or update writes a plain object to a `jsonb` column
- **THEN** it type-checks, the compiled statement carries the serialized
  document as a bind parameter, and reading the row back yields an equal
  value

#### Scenario: A brand narrows the write as well as the read
- **WHEN** a `jsonb().$type<T>()` column is written a value that is not a
  `T`
- **THEN** it fails to type-check

#### Scenario: Bytes are written as bytes
- **WHEN** a `bytea` column is written a `Uint8Array`
- **THEN** it type-checks, the value is hex-encoded into a bind
  parameter, and reading the row back yields the same bytes; a string is
  refused

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
result types unchanged. The write side is not widened by the brand: a
`json`/`jsonb` column, branded or not, accepts only an `Expr` (see the
insert/update input-types requirement).

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

### Requirement: Nested read types equal the declared read types
A row read through `jsonArrayFrom`/`jsonObjectFrom` or `related()`
SHALL surface each column with exactly the TypeScript type the same
column has in a top-level select — a `bigint`-mode column reads
`bigint`, a datetime column reads `Date`, an `interval` column reads
the structured value, arrays keep their element nullability — never
the JSON-mediated shape (`number`/`string`). A `jsonArrayFrom`
projection key SHALL type as `ReadonlyArray<Row>` (empty array when no
child matches, never `null`); a `jsonObjectFrom` or forward `related()`
key SHALL type as `Row | null`. `related()` keys SHALL be derived at
the type level from the declared foreign-key edges — reverse keys from
the schema map's table names, forward keys from the FK column name
with one trailing `Id` stripped — so autocomplete offers exactly the
derivable relations and nothing else.

#### Scenario: Nested and top-level types agree column by column
- **WHEN** `comments.createdAt` (`timestamptz`) and `posts.viewCount`
  (`bigint`) are read once at top level and once inside a nested read
- **THEN** both positions type `createdAt: Date` and
  `viewCount: bigint` — identical

#### Scenario: Collection and single-row shapes
- **WHEN** a select projects a `jsonArrayFrom` key and a forward
  `related()` key
- **THEN** the first types `ReadonlyArray<Row>` and the second
  `Row | null`

#### Scenario: Relation keys are derived, not invented
- **WHEN** `posts.ownerId` declares `.references(() => users.id)` and
  `comments.postId` references `posts.id`
- **THEN** `related()` on `posts` accepts exactly the keys `owner`
  (single row) and `comments` (collection), and any other key fails to
  type-check

### Requirement: Set-operation branches must be row-compatible, and the result types honestly
A set-operation combinator SHALL fail to type-check when the two
branches' result rows carry different key sets — the database would
reject the statement, so the program does first. The combined result
row SHALL take the LEFT branch's keys (SQL's own naming rule); each
column's type SHALL be the union of the two branches' declared read
types for that key (identical declarations stay unchanged), and a
column nullable in EITHER branch SHALL be nullable in the result.

#### Scenario: Identical branch shapes pass through unchanged
- **WHEN** two whole-table selects over identically-declared tables
  combine with `.union(...)`
- **THEN** the awaited row type equals the single-select row type

#### Scenario: Mismatched keys are rejected at compile time
- **WHEN** a select over `{ id, name }` unions a select over
  `{ id, title }`
- **THEN** the program fails to type-check rather than compiling a
  statement the database would reject

#### Scenario: Nullability widens to the union
- **WHEN** a branch with a `notNull` column unions a branch where the
  same key is nullable
- **THEN** the result types that column as nullable

### Requirement: Enum columns type as their declared values
A column declared from `pgEnum(schema, name, values)` SHALL read back as
the union of those values and SHALL accept only those values as a write,
in every position that resolves a declared column's type — a whole-table
select, a `returning` projection, and insert/update input alike.
Nullability remains the column's own axis: a value union widens with
`| null` exactly when the column is not `notNull`.

The values SHALL reach the type without being restated by the user. A
declaration that records no values SHALL keep typing as `string` rather
than narrowing to an empty union, so an enum whose values are not
statically known stays usable.

#### Scenario: A declared enum reads as its values
- **WHEN** a table declares `status: postStatus.column().notNull()` from
  `pgEnum(app, "post_status", ["draft", "published"])`
- **THEN** a whole-table select's row type reads `status` as
  `"draft" | "published"`, not `string`

#### Scenario: An undeclared value fails to type-check as a write
- **WHEN** an insert or update writes a string that is not one of the
  declared values to that column
- **THEN** it fails to type-check, rather than compiling and being
  rejected by the database at runtime

#### Scenario: Nullability stays a separate axis
- **WHEN** the same enum column is declared without `notNull`
- **THEN** its read type is the value union widened with `| null`

### Requirement: An aggregate's result type is the type it really returns
A projected aggregate SHALL read back as the type Postgres actually
returns for it, and the runtime conversion SHALL deliver that type — a
declared result type without the matching conversion would describe the
driver's raw text rather than the value.

- `count()`/`countWhere(expr)` SHALL type as `bigint` and SHALL be
  converted to one: Postgres's `count` is `int8` whatever it counted.
- `min(expr)`/`max(expr)` SHALL type and convert as their argument does,
  which is what Postgres returns for them.
- `sum(expr)`/`avg(expr)` SHALL type as the numeric family's widest
  honest type. Postgres promotes their result by the argument's exact
  type, so a single declared result type would be wrong for most inputs;
  widening is the honest answer until that promotion is modeled.

#### Scenario: count is a bigint end to end
- **WHEN** a select projects `count()` and executes against a real
  database
- **THEN** the field's type is `bigint | null` and the value that arrives
  is a `bigint`, not the text the driver hands back for `int8`

#### Scenario: max keeps its argument's declared type
- **WHEN** a select projects `max(column)` over a column declared with a
  numeric mode
- **THEN** the field's type is that column's own declared read type, not
  the numeric family's union

#### Scenario: sum stays honestly wide
- **WHEN** a select projects `sum(column)`
- **THEN** the field's type is the numeric family's union rather than a
  single type that would be wrong for most argument types
