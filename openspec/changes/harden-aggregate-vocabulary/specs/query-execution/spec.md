## MODIFIED Requirements

### Requirement: A db handle executes built statements
A db handle SHALL be constructed from schema declarations plus a driver
and SHALL execute built statements, returning rows typed by the
statement's inferred result type. What is sent to the database for a
statement SHALL be exactly the statement's pure `compile()` output; an
applied execution context precedes it on the same transaction, per
`rls-execution-context`, and is not part of the statement.

#### Scenario: Executed SQL equals previewed SQL
- **WHEN** a statement is compiled for preview and then executed on a db
  handle — with or without an execution context applied
- **THEN** the SQL text and parameters the driver receives for that
  statement are identical to the previewed compile output, any context
  statements the handle applies precede it inside the same transaction
  rather than altering it, and the resolved rows carry the inferred
  result type

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

A nested cell SHALL NOT lose that protection by being an aggregate or
a window function rather than a plain column. One vocabulary, owned by
the core and read by both the cast side and the revive side, SHALL
name for every builder aggregate and window function how its result
reads back: as `int8` (`count`, `row_number`, `rank`, `dense_rank` —
cast to text and revived as `bigint`), as its first argument's own
type (`min`, `max`, `lag`, `lead`, `first_value`, `last_value`,
`nth_value` — cast and revived exactly as that argument would be), or
as its own JSON-safe shape (`sum`, `avg`, `percent_rank`, `cume_dist`,
`ntile` — neither cast nor converted: `sum`/`avg` promote by the
argument's exact type, so a fixed conversion would be a lie, and the
other three are carried losslessly). A windowed cell reads as its
inner call on both sides. The vocabulary SHALL be closed over the
builder's constructors: a constructor without a row fails to
type-check, and a name that drifts from its row is caught by a test
that enumerates the constructors from the public surface. A cell is
cast exactly when it is revived.

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

#### Scenario: A windowed cell keeps its precision too
- **WHEN** a nested collection projects `over(count(), …)`,
  `over(max(col), …)` and `over(lag(col), …)` over a `bigint` column
  whose value is past `Number.MAX_SAFE_INTEGER`
- **THEN** each delivered value is exactly that `bigint`, the compiled
  SQL shows the text cast on each, and a nested `over(sum(col), …)`
  is neither cast nor converted

#### Scenario: Every builder function is classified, and cast agrees with revive
- **WHEN** every aggregate and window constructor the public surface
  exports is invoked and its node's function name looked up in the
  vocabulary, and a nested cell of each is executed
- **THEN** every name has a row, and each cell is cast in the compiled
  SQL exactly when its value is revived — both for the rows that read
  back as `int8` or as their argument, neither for the rows that read
  back as their own shape

#### Scenario: An explicit user cast is left alone
- **WHEN** a nested cell is written as `` sql`${max(posts.views)}::text` ``
- **THEN** the delivered value is the text the cast asked for, not a
  revived `bigint`

#### Scenario: One statement under the RLS context
- **WHEN** `db.as(ctx).select(posts).related({ comments: true })` runs
- **THEN** exactly one statement executes inside the context's
  transaction, and the nested rows obey the same RLS policies the
  context grants
