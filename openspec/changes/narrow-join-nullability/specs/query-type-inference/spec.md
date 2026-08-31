# query-type-inference (delta)

## REMOVED Requirements

### Requirement: Result types are inferred from declarations
**Reason**: Its third paragraph ("Every object-projection field SHALL
type as possibly `null` … a known, deliberate widening") and the
scenario that pinned it are no longer true — a projected field's
nullability now follows its declaration unless its source table was
left-joined. The requirement is split rather than modified because the
scenario asserting the blanket widening cannot be revised in place under
a title that asserts the opposite, and because the join rule is an
independent contract that would otherwise share one heading with the
declared-type rules.
**Migration**: Continues as the ADDED requirements "Result types and
their nullability are inferred from declarations" (the declared-type,
projected-key and array-element rules, unchanged in substance) and "A
left join is what widens a projected field's nullability" (the
join-tracking rule and its boundaries).

## ADDED Requirements

### Requirement: Result types and their nullability are inferred from declarations
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

An object-projection field's **nullability** SHALL follow the same
declaration rather than a blanket widening: a field that projects a
declared column **directly** types as that column declares, unless the
column's source table is left-joined in the same statement (the
left-join requirement below owns that case). A field that projects
anything else SHALL stay widened to nullable — including an expression
that carries a declared column's origin through it. `min`/`max` and the
window value functions return SQL NULL for reasons that have nothing to
do with joins (an aggregate over no rows, a partition boundary), so
being *derived from* a `notNull` column is not grounds for narrowing;
only a direct column reference is narrowed. Whole-table projections and
`returning()` without a projection are unaffected and carry declared
nullability, as they always have.

A `returning()` projection SHALL follow the declaration too, with no
left-join widening applied — **on the stated premise that a mutation
carries no join grammar**: `insert`/`update`/`deleteFrom` offer no
`leftJoin` and no `UPDATE … FROM`, so the set of left-joined tables at
that position is not unknown but definitively empty. A change that
gives mutations a join grammar must revisit this paragraph; the premise
is written down so that it cannot be broken silently.

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

#### Scenario: A projected notNull column is not nullable without a left join
- **WHEN** a select with no left join projects a `notNull` declared
  column under an alias
- **THEN** the field types as the declared non-null type, and code that
  handles it as possibly `null` is redundant rather than required

#### Scenario: A value derived from a notNull column stays nullable
- **WHEN** a select with no left join projects `max(column)` or
  `over(lag(column), …)` over a `notNull` declared column
- **THEN** the field still types as possibly `null` — the value can be
  SQL NULL for reasons the declaration does not govern (no rows to
  aggregate, a partition boundary), so it is not narrowed with the
  direct column reference

#### Scenario: A returning projection follows the declaration
- **WHEN** an insert, update or delete projects a `notNull` declared
  column through `returning({ … })`
- **THEN** the field types as the declared non-null type — a mutation
  has no join grammar, so no left join can null it

#### Scenario: Array element nullability follows the declaration
- **WHEN** a table declares `tags: text().array()` and
  `labels: text().array().notNullElements()`
- **THEN** a whole-table select's row type reads `tags` with elements
  typed `string | null` and `labels` with elements typed `string`

### Requirement: A left join is what widens a projected field's nullability
A select's builder stages SHALL carry, at the type level, the set of
tables joined with `leftJoin`, and a projected field whose source table
is in that set SHALL type as possibly `null` regardless of the column's
own `notNull` — a left join is exactly the construct that produces NULLs
for a column the declaration calls non-null. `innerJoin` SHALL NOT widen
anything: it emits no such row.

Where the join set is **not** carried, every projected field SHALL stay
widened to nullable, exactly as before this requirement existed. That is
the fail-safe direction: a position that cannot see the statement's
joins must never narrow. Row types resolved without a statement's join
set — a nested read's subselect (`jsonArrayFrom`/`jsonObjectFrom`), a
CTE body, a view body, `related()`, and any hand-written use of the
result-type utility — therefore keep the old widening, and this
requirement makes no claim about them.

A table's identity at the type level is **structural**: a declared table
is its column map, and nothing in it carries the table's name. Two
tables declared with identical column maps are therefore
indistinguishable here, and a projected field of one is widened when the
other is left-joined. The same holds for a statement that left-joins its
own `from` table (a self-join): the two sides are not distinguished. In
both cases the error is toward **widening** — a field is nullable that
could have stayed non-null. A left-joined column can never be narrowed
by such a collision, which is what makes the imprecision acceptable
rather than a lie.

#### Scenario: A left-joined table's column is nullable
- **WHEN** a select projects a `notNull` column of a table the same
  statement joined with `leftJoin`
- **THEN** the field types as possibly `null`

#### Scenario: The from table's columns keep their declaration across a left join
- **WHEN** that same statement also projects a `notNull` column of the
  table it selects from
- **THEN** that field types as the declared non-null type — only the
  left-joined side is widened

#### Scenario: An inner join widens nothing
- **WHEN** a select projects `notNull` columns of both tables of an
  `innerJoin`
- **THEN** both fields type as their declared non-null types

#### Scenario: A row type resolved without the join set stays widened
- **WHEN** a projection's row type is resolved in a position that does
  not carry the statement's left-joined set — a nested read's subselect,
  a CTE body, a view body, or `related()`
- **THEN** every projected field types as possibly `null`, the same
  widening that applied before joins were tracked

## MODIFIED Requirements

### Requirement: An aggregate's result type is the type it really returns
A projected aggregate SHALL read back as the type Postgres actually
returns for it, and the runtime conversion SHALL deliver that type — a
declared result type without the matching conversion would describe the
driver's raw text rather than the value.

- `count()` SHALL type as `bigint` and SHALL be converted to one:
  Postgres's `count` is `int8` whatever it counted. The projected field
  is additionally widened with `| null`, as every aggregate field is:
  an aggregate is not a direct column reference, so the declaration
  narrowing does not reach it.
- `min(expr)`/`max(expr)` SHALL type and convert as their argument does,
  which is what Postgres returns for them. Their field SHALL stay
  nullable even when the argument is a `notNull` column and the
  statement has no left join — an aggregate over no rows is SQL NULL.
- `sum(expr)`/`avg(expr)` SHALL type as the numeric family's widest
  honest type. Postgres promotes their result by the argument's exact
  type, so a single declared result type would be wrong for most inputs;
  widening is the honest answer until that promotion is modeled.

There is no separate filtered-count constructor; the negative-space
statement for `FILTER (WHERE …)` is owned by query-builder's aggregate
requirement.

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

### Requirement: A window function's result type is the type it really returns
A projected window function SHALL read back as the type Postgres actually
returns for it, and the runtime conversion SHALL deliver that type — the
rule aggregates already follow.

- `rowNumber()`/`rank()`/`denseRank()` SHALL type as `bigint` and SHALL be
  converted to one: Postgres returns `int8` for all three.
- `ntile(n)`/`percentRank()`/`cumeDist()` SHALL type as the numeric
  family's read type and need no conversion — `int4` and `float8` arrive
  as JavaScript numbers already.
- `lag`/`lead`/`firstValue`/`lastValue`/`nthValue` SHALL type as their
  argument does, which is what Postgres returns for them.
- A windowed aggregate SHALL keep the aggregate's own mapping: wrapping
  `count()` in `over()` SHALL NOT change what it reads back as, nor how it
  converts.

Every window function's projected field SHALL additionally stay nullable,
including in a statement with no left join and including when its
argument is a `notNull` column: an offset function called without a
`default` returns SQL NULL at a partition boundary, so a field narrowed
to the argument's declared non-null type would be a lie the runtime
disproves on the first partition.

#### Scenario: rowNumber is a bigint end to end
- **WHEN** a select projects `over(rowNumber(), …)` and executes against a
  real database
- **THEN** the field's type is `bigint | null` and the value that arrives
  is a `bigint`, not the text the driver hands back for `int8`

#### Scenario: A windowed count converts like a count
- **WHEN** a select projects `over(count(), …)`
- **THEN** the field reads back exactly as an unwindowed `count()` does

#### Scenario: A value function keeps its argument's declared type
- **WHEN** a select projects `over(lag(column), …)` over a column declared
  with a numeric mode
- **THEN** the field's type is that column's own declared read type

#### Scenario: An offset function stays nullable without a left join
- **WHEN** a select with no left join projects `over(lag(column), …)`
  over a `notNull` column, with no `default` argument
- **THEN** the field types as possibly `null`, because the first row of
  each partition has no preceding row to read
