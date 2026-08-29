# query-execution (delta)

## MODIFIED Requirements

### Requirement: Nested values are revived to their declared types
Executing a statement with nested reads SHALL deliver every nested
value converted to its column's declared read type, exactly as a
top-level read converts it — `bigint` values past 2^53 arrive intact
as `bigint` (the compiler casts at-risk columns to text inside the
JSON payload; the casts are visible in `compile()`), datetimes arrive
as `Date`, structured values arrive structured. The whole read is one
statement in one round trip — under an RLS execution context it runs
inside that context's single transaction like any other statement,
and no client-side stitching across statements occurs. An empty
collection arrives as `[]`; a missing single row arrives as `null`.

A nested cell SHALL NOT lose that protection by being an aggregate
rather than a plain column: `count()` and a `min`/`max` over an
at-risk column are cast and revived the same way, because JSON has
already lost the precision by the time the value reaches the client
and a wrong value is worse than an unconverted one. `sum`/`avg` are
deliberately outside this: their result type is not the argument's,
so they are neither cast nor converted, and casting them would deliver
text where a number is expected.

The at-risk cast is the compiler's own encoding, and conversion SHALL
undo exactly that: a value arriving through it is revived by the type
of the expression *inside* the cast — whatever that expression is, a
column reference or an aggregate — so a newly castable cell shape does
not also require teaching the reviver a new expression kind. A `::text`
cast a user writes through the `sql` escape hatch SHALL NOT be undone:
an explicit cast is an instruction, and reviving past it would deliver
a `bigint` where its author asked for text.

#### Scenario: Precision survives the JSON round trip
- **WHEN** a child row holds a `bigint` column value of
  `9007199254740993n` (past `Number.MAX_SAFE_INTEGER`) and the parent
  is read with a nested collection
- **THEN** the delivered nested value is exactly `9007199254740993n`,
  and the compiled SQL shows the text cast that preserved it

#### Scenario: An aggregate cell keeps its precision too
- **WHEN** a nested collection projects `count()` or `max()` over a
  `bigint` column whose value is past `Number.MAX_SAFE_INTEGER`
- **THEN** the delivered value is exactly that `bigint`, not a rounded
  number and not the cast's text

#### Scenario: An explicit user cast is left alone
- **WHEN** a nested cell is written as `` sql`${max(posts.views)}::text` ``
- **THEN** the delivered value is the text the cast asked for, not a
  revived `bigint`

#### Scenario: One statement under the RLS context
- **WHEN** `db.as(ctx).select(posts).related({ comments: true })` runs
- **THEN** exactly one statement executes inside the context's
  transaction, and the nested rows obey the same RLS policies the
  context grants
