# query-builder (delta)

## ADDED Requirements

### Requirement: Selects compute over windows
The builder SHALL provide the window vocabulary — `rowNumber`, `rank`,
`denseRank`, `percentRank`, `cumeDist`, `ntile`, `lag`, `lead`,
`firstValue`, `lastValue`, `nthValue` — and `over(expr, spec)`, which
takes either one of those or an existing aggregate and attaches a window
specification carrying `partitionBy` and `orderBy`.

Window functions SHALL render as Postgres's own function names followed by
`over (…)`, with `partition by` and `order by` in SQL's own order and
omitted when empty. A frame clause is not emitted; rendering none is
exactly Postgres's default.

The eleven window-only constructors SHALL NOT be usable where an
expression is expected until `over()` has wrapped them, because Postgres
rejects every one of them without an `OVER` clause.

#### Scenario: Ranking within a partition
- **WHEN** a select projects a column and `over(rank(), …)` partitioned by
  one column and ordered by another
- **THEN** the compiled SQL carries `rank() over (partition by … order by
  …)`, and the database restarts the ranking in each partition

#### Scenario: An aggregate becomes a running total
- **WHEN** a select projects `over(sum(column), { orderBy: [...] })`
- **THEN** the compiled SQL carries `sum(…) over (order by …)` and the
  aggregate keeps its own meaning, with no `group by` implied

#### Scenario: A window-only call must be wrapped
- **WHEN** `rowNumber()` is used directly as a projection
- **THEN** it is not accepted where an expression is required

#### Scenario: over refuses a target that is not a function call
- **WHEN** `over()` is given a plain column
- **THEN** it fails immediately, naming what may be wrapped

### Requirement: Window functions are refused where Postgres refuses them
`where()`, `groupBy()` and `having()` SHALL refuse an argument containing
a window function, failing at build time with a diagnostic that names the
clause, states that window functions are evaluated after it, and gives the
remedy. An aggregate SHALL likewise refuse an argument containing a window
function.

`distinctOn` SHALL NOT refuse one: Postgres accepts a window function
there, and refusing it would make the builder stricter than the database.

A window function inside a subquery's own select list SHALL remain legal —
the check does not descend into an embedded query.

#### Scenario: Filtering on a window result is refused
- **WHEN** a comparison against a window function is passed to `where`
- **THEN** it fails immediately, naming the clause and the evaluation
  order, and pointing at the select list or a subquery instead

#### Scenario: distinct on accepts a window function
- **WHEN** `distinctOn` is given a window function
- **THEN** the statement compiles, matching what Postgres accepts

#### Scenario: An aggregate refuses a windowed argument
- **WHEN** an aggregate is given an argument containing a window function
- **THEN** it fails immediately, matching Postgres's own separate rule

### Requirement: A window survives serialization
A view body carrying a window function SHALL round-trip through the
snapshot codec unchanged, and a rename SHALL rewrite column references
inside the window specification as it does anywhere else.

A stored window node missing its function call SHALL be rejected, not
repaired. The codec tolerates an absent field only where an older format
version genuinely wrote it out; `window` is new in this version, so its
absence is corruption rather than an older shape, and decoding it into a
plausible value would turn a damaged snapshot into a silently different
declaration.

#### Scenario: A view with a window function round-trips
- **WHEN** a view whose body projects a window function is serialized and
  read back
- **THEN** the decoded query is the same query, window specification
  included

#### Scenario: A rename reaches inside the window
- **WHEN** a column referenced only inside `over()`'s `partitionBy` is
  renamed
- **THEN** the stored expression names the new column, not the old one

#### Scenario: A damaged window node is refused, not repaired
- **WHEN** a stored window node has no function call
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described
