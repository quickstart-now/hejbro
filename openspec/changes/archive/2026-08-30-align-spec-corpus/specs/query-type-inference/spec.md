# query-type-inference Delta

## REMOVED Requirements

### Requirement: A recursive term is typed from its anchor
**Reason**: Split — the anchor-typing rule, the nullability elision with
its stated residue, and the same-family divergence limitation are
independently revisable decisions that shared one 93-line heading.
**Migration**: Continues in the ADDED requirements "The recursive-term
reference is typed from the anchor", "Recursive-term nullability is
elided, and the residue is stated", and "A same-family type divergence
between recursive branches is not caught".

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
and this layer cannot yet see which tables were left-joined — a known,
deliberate widening. Whole-table projections and `returning()` without a
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

### Requirement: Interval columns surface as a structured value
An `interval` column SHALL surface as the structured `IntervalValue`
type, not `unknown`: an object with exactly the readonly number fields
`years`, `months`, `days`, `hours`, `minutes`, `seconds`, and
`microseconds`. The fields SHALL map onto Postgres's own independent
storage axes — `years`/`months` onto the whole-months axis, `days` onto
the whole-days axis, and `hours`/`minutes`/`seconds`/`microseconds`
onto the sub-day axis with microsecond precision — without ever
converting between axes, since Postgres itself has no fixed ratio
between them (a month's day count varies). Reading an interval SHALL
always produce a fully normalized value — the same interval SHALL read
back as the identical value regardless of which axes its source text
happened to mention explicitly — where normalization operates within
each axis only, never across axes.

#### Scenario: Structured value, not unknown
- **WHEN** an `interval` column is projected
- **THEN** the result field's TypeScript type is the structured
  `IntervalValue` object with its seven number fields, not `unknown`,
  and none of its fields is dropped or rounded away

#### Scenario: Normalization stays within an axis
- **WHEN** the same interval is stored once as `14 months` and once as
  `1 year 2 months`
- **THEN** both read back as the identical value (`years: 1, months: 2`
  on the months axis), and no amount is ever moved between the months,
  days, and sub-day axes

### Requirement: `$type` narrows the visible type; jsonb is unknown unless branded
On any declared column, `.$type<T>()` SHALL only narrow the visible
TypeScript type — `T` MUST be a subset of the column's own base
TypeScript type, and a `T` that is not SHALL fail to type-check rather
than silently taking effect. A `json`/`jsonb` column SHALL surface as
`unknown` in query types unless the declaration opts in to a `$type`
brand, in which case the branded TypeScript type SHALL flow through
result types unchanged. On the write side the brand narrows rather than
widens: an unbranded `json`/`jsonb` column accepts any JSON-serializable
value (see the insert/update input-types requirement), and a branded one
accepts `T` and nothing wider. An array column whose element type is
`json`, `jsonb` or `bytea` keeps its own separate Expr-only write rule
regardless of branding.

#### Scenario: Opt-in brand flows through
- **WHEN** a `jsonb` column declares a `$type` brand and is projected
- **THEN** the result field has the branded type, and an unbranded
  `jsonb` column projected alongside it has type `unknown`

#### Scenario: A brand outside the column's base type is rejected
- **WHEN** a declaration calls `.$type<T>()` with a `T` that is not a
  subset of the column's own base TypeScript type (e.g. `integer()`,
  whose base type is `number`, with `.$type<string>()`)
- **THEN** the declaration fails to type-check

### Requirement: Set-operation branches must be row-compatible, and the result types honestly
A set-operation combinator SHALL fail to type-check when the two
branches' result rows carry different key sets.

This is not a rule the server imposes. Postgres matches set-operation
branches by **position and type**, never by name — measured twice, from
two different angles. First: unioning `{email, city}` against the same
key SET reordered to `{city, email}` compiles and executes, and the
combined result keeps the LEFT branch's own column names while the
values underneath came from the wrong position. Second: a plain
two-column union whose branches' column NAMES genuinely differ at both
positions (`select a.email, a.city from a union select b.login, b.town
from b`, no common name at either position) still compiles and executes,
and the combined result again keeps the left branch's own names
(`email, city`, confirmed both from the query directly and from
`information_schema.columns` behind a view over it) — with a positive
control alongside it (a genuine type mismatch at a position, `42804`)
confirming the instrument reports a real refusal when there is one, so
the acceptance above is not the silence of a broken check. Together the
two measurements cover both ways a key set can diverge from an exact
match — same set, different order, and genuinely different names — and
Postgres refuses neither. The refusal this requirement imposes is
TypeScript's own: a `SelectProjection` is keyed by name, so a branch pair
whose key sets differ has no honest single row type to assign —
reconciling it would mean inventing a value for a key one branch never
projects, or silently dropping a key the other branch does. Failing to
type-check is more honest than either, which is the actual justification,
not a claim that the database would refuse the statement.

The combined result row SHALL take the LEFT branch's keys — SQL's own
naming rule, demonstrated by both measurements above — with each
column's type the union of the two branches' declared read types for
that key (identical declarations stay unchanged), and a column nullable
in EITHER branch SHALL be nullable in the result.

#### Scenario: Identical branch shapes pass through unchanged
- **WHEN** two whole-table selects over identically-declared tables
  combine with `.union(...)`
- **THEN** the awaited row type equals the single-select row type

#### Scenario: Mismatched keys are rejected at compile time
- **WHEN** a select over `{ id, name }` unions a select over
  `{ id, title }`
- **THEN** the program fails to type-check even though the server itself
  would accept the equivalent hand-written SQL (measured) — the refusal
  is TypeScript's own name-keyed row type having no single honest shape
  to assign when a key set differs, not a claim about what the server
  does

#### Scenario: Nullability widens to the union
- **WHEN** a branch with a `notNull` column unions a branch where the
  same key is nullable
- **THEN** the result types that column as nullable

### Requirement: An aggregate's result type is the type it really returns
A projected aggregate SHALL read back as the type Postgres actually
returns for it, and the runtime conversion SHALL deliver that type — a
declared result type without the matching conversion would describe the
driver's raw text rather than the value.

- `count()` SHALL type as `bigint` and SHALL be converted to one:
  Postgres's `count` is `int8` whatever it counted. Like every
  object-projection field, the projected field is additionally widened
  with `| null`.
- `min(expr)`/`max(expr)` SHALL type and convert as their argument does,
  which is what Postgres returns for them.
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

## ADDED Requirements

### Requirement: The recursive-term reference is typed from the anchor
The reference a recursive term is written against SHALL be typed from the
anchor term's projection. A recursive term whose projection does not match
the anchor's SHALL NOT type-check, matching Postgres's requirement that
both branches of the union agree.

"Match" here means **the same key set** — the compatibility test a set
operation already applies, because a recursive CTE *is* an anchor and a
recursive term joined by `UNION`. The **CTE's own column types come from
the anchor**, not from a union of the two branches: a plain union widens
(`int` and `bigint` resolve to `bigint`), but a recursive CTE refuses to
(`42804`, "column N has type integer in non-recursive term but type
bigint overall"). So the compatibility *test* is shared; the resulting
row type is the anchor's. Requiring the two projections to be identical
would be stricter than that rule and would reject constructs Postgres
genuinely accepts in a recursive term.

This check holds in the core builder, where the recursive term is
written, and in every set-op combinator core provides (`union`/
`unionAll`/`intersect`/`intersectAll`/`except`/`exceptAll`), not only
the recursive-term case. The query package's own chain surface carries
the identical check independently.

#### Scenario: The recursive term sees the anchor's columns
- **WHEN** a recursive term is written inside the callback that receives
  the CTE's own reference
- **THEN** that reference's columns are the anchor term's projected fields,
  with the anchor's types

#### Scenario: A recursive term missing one of the anchor's keys is refused
- **WHEN** a recursive term projects a different key set from the anchor
- **THEN** it does not type-check

#### Scenario: A field computed differently on each side is accepted
- **WHEN** the anchor projects a column directly and the recursive term
  projects the same key through a window function
- **THEN** it type-checks, and the field reads back as the **anchor's**
  type — how the recursive term computes it is not part of the CTE's row
  type

### Requirement: Recursive-term nullability is elided, and the residue is stated
The recursive-term compatibility test SHALL elide nullability when
comparing the anchor's and the recursive term's projected keys — a rule
tightened to require an exact type match would count a nullable value
against a non-null one and reject constructs Postgres accepts. The
relaxation is justified by measurement: a key nullable in the recursive
term where the anchor's is not is accepted by postgres:17 (`pg_typeof`
stays the anchor's type on every row), and a same-family declared-type
divergence resolving through the anchor's own type is accepted too.

The relaxation approves exactly those two measured divergences and
nothing wider. In particular it is no license for a recursive term to
compute a shared key with an aggregate or a window function: an
aggregate in the recursive term is refused outright by Postgres
(`42P19`, "aggregate functions are not allowed in a recursive query's
recursive term", measured), and the measured window construct
(`row_number() over ()`, whose value does not advance with the
recursion) never terminates rather than returning a row — neither is
evidence the category is safe, and this requirement makes no such
claim.

The elision leaves a known, measured residue: an anchor projecting a
non-null value and a recursive term projecting a nullable value for the
SAME key still type-checks, and the CTE's declared row type stays the
anchor's (non-null) — but the recursive term's null genuinely reaches
the result rows. The unsoundness here is hejbro's own — the type system
infers non-null and that inference is what is wrong, not anything
Postgres does; no measured query carried a `NOT NULL` constraint, so
this is not "Postgres ignores the anchor's `NOT NULL`". Widening the
declared row type instead would contradict the rule that the row type is
always the anchor's — that trade-off is deliberately left open rather
than settled here.

Elision covers nullability only. A `.$type<T>()` brand (a TS-only tag on
a column's declared type, invisible to Postgres) is a separate axis this
requirement does not elide or otherwise address — a stated boundary
rather than a silently dropped case.

#### Scenario: A recursive term nullable where the anchor is not still compiles
- **WHEN** the anchor projects a non-null value for a key and the
  recursive term projects a nullable value for the same key, with no
  other type divergence
- **THEN** it type-checks, and the CTE's declared row type is the
  anchor's non-null type — even though a null value from the recursive
  term can genuinely reach the result rows (measured)

### Requirement: A same-family type divergence between recursive branches is not caught
The recursive term's declared TYPE (as opposed to whether it is
nullable) is measured to be **directional** and is not caught at build
time. The identical type pair behaves differently depending on which
side is the anchor: a `numeric` anchor with a `bigint` recursive term is
accepted and resolves to `numeric`; a `bigint` anchor with a `numeric`
recursive term — the same pair, reversed — is refused with `42804`. The
failure condition is "the recursive term's resolved type differs from
the anchor's", decided by Postgres's own implicit-cast resolution, not a
symmetric equality test. This is not expressible as a build-time
TypeScript check without reproducing that resolution table: the
package's SQL type families collapse the whole numeric family into one,
so nothing at the family level (the coarsest type information a
key-based compatibility check has) can tell the accepted pair from the
refused one. A same-family type divergence on a shared key therefore
still type-checks and can fail on the server instead of at build time.
The compatibility test SHALL NOT be presented as covering this axis —
it is a stated open boundary, not a claim of coverage.

#### Scenario: A same-family type divergence between anchor and recursive term is not caught
- **WHEN** the anchor and the recursive term project the same key with
  two different declared types that share one SQL type family (e.g.
  `numeric` and `bigint`)
- **THEN** it type-checks regardless of which side is the anchor —
  Postgres's own directional resolution (accepting one order, refusing
  the reversed order with `42804`, measured) is not reproduced here
