# query-builder (delta)

## MODIFIED Requirements

### Requirement: Select statements over declared tables
The query package SHALL build select statements from declared tables
with an explicit column projection, optional `where`, `order`, `limit`,
and inner/left joins. The rendered SQL SHALL always list columns
explicitly and SHALL never contain `select *`.

`order` SHALL accept `asc(column)`/`desc(column)`, each optionally
carrying a `nulls: "first" | "last"` placement, and SHALL render Postgres's
own `nulls first`/`nulls last` suffix after the direction (harden-query-
surface #470 — the same vocabulary a declared index's own column order
already accepted; a query's `orderBy` previously accepted only a bare
column or direction, with no way to spell a nulls placement at all). A
window specification's own `orderBy` and a set operation's whole-set
`orderBy` accept the identical vocabulary, rendered the same way, rather
than each position inventing its own spelling.

#### Scenario: Basic select with filter, order, and limit
- **WHEN** a select over a declared table picks named columns and adds a
  `where` condition, an `order`, and a `limit`
- **THEN** compiling yields one SQL statement listing exactly the picked
  columns, with the condition values passed as bind parameters, and the
  given ordering and limit

#### Scenario: Inner and left join between declared tables
- **WHEN** a select joins a second declared table with an inner or left
  join on a column equality
- **THEN** the compiled SQL contains the corresponding `join` /
  `left join` clause and every projected column stays schema-qualified
  and explicitly listed

#### Scenario: A nulls placement is spelled and rendered
- **WHEN** an `order` calls `asc(column, { nulls: "first" })` or
  `desc(column, { nulls: "last" })`
- **THEN** the compiled SQL renders `nulls first`/`nulls last` right
  after the direction, and the same call compiles identically inside a
  window specification's `orderBy` and a set operation's whole-set
  `orderBy`

### Requirement: Set operations combine selects into one visible statement
A select chain SHALL offer `.union(other)`, `.unionAll(other)`,
`.intersect(other)`, `.intersectAll(other)`, `.except(other)`, and
`.exceptAll(other)`, each combining the current select with `other`
(another select, or a prior combination — nesting composes) into one
set-operation statement. The combined statement SHALL render as the
branches' own SQL joined by the operator keyword (`union`,
`union all`, `intersect`, …), with any `orderBy`/`limit` called AFTER
the combination applying to the WHOLE set — the SQL placement
Postgres itself gives them. The entire emitted SQL SHALL be visible
through `compile()`. A set-operation query SHALL be a valid view body:
`defineView` accepts it, the snapshot codec round-trips it
structurally (no format-version change — a new node kind is
vocabulary), and the view's declared column list resolves from the
LEFT branch, SQL's own naming rule.

Branch compatibility divides between two mechanisms (harden-query-surface,
groups 3 and 8), each covering what the other cannot see. A key SET
mismatch is caught by the type layer (`SetOpResult` resolving to
`never`, group 3); a genuine TYPE divergence between two branches'
same-named column is caught by the server itself (`42804`, "UNION
types uuid and text cannot be matched" — measured, SQLSTATE captured).
Neither catches a branch pair whose keys match in SET but not in
ORDER: `keyof` has no order, so the type layer cannot see it, and
Postgres matches set-operation branches by POSITION, not by name, so a
matching-set, different-order pair is legal SQL to the server too —
and silently corrupts data instead of erroring (measured on
postgres:17.11: unioning `{email, city}` against `{city, email}`
returns rows with the `email` output column holding a city value and
the `city` column holding an email, reproduced in both a bare `select`
and a `create view`, the exact review finding that added group 8
mid-flight). `except` and `intersect` corrupt the same way, not only
`union` — `except` is the worst of the three: a position-mismatched
comparison can still return one plausible-looking row, so nothing
about the result signals that the wrong columns were compared. A
build-time guard — not a type-level one, for the same
`keyof`-has-no-order reason — SHALL refuse this case before either
branch reaches the server, naming both branches' own key order and the
first position at which they disagree. This guard SHALL apply at
every construction site a set operation can be built from: the core
builder, the query package's own chain surface (which builds its
`union()` family independently, never routing through the core
builder), and a recursive CTE's anchor/recursive-term pair (grammatically
`anchor UNION [ALL] recursive-term`, Postgres) — the recursive-term
type rule (`query-type-inference`, the recursive-term requirement) is
itself `SameKeys`-based like every other type-level check in this
change and so cannot see order either, and reads as the SAME rule
applied to the same construct, not a plain-union special case with an
unstated recursive-CTE exception. A snapshot decoded from disk is
OUTSIDE this guard's reach — decoding a `SetOpNode` is deliberately
lenient by an earlier, standing decision (absence in a stored node is
read as history, not as invalid input), and a construction-time guard
cannot run on a path that never constructs the node — one input to
that path (a hand-edited snapshot file) is a genuinely reachable
surface, and is addressed one layer up: `hejbro verify` hashes the
parsed-and-re-rendered snapshot against its recorded value and reports
a reordered set-op branch as a mismatch, when the user runs that
command.

#### Scenario: Union of two selects renders one statement
- **WHEN** `select(activeUsers).union(select(archivedUsers))` compiles
- **THEN** the SQL is the two branch selects joined by `union`, and
  awaiting it yields the deduplicated combined rows

#### Scenario: Whole-set order and limit attach after combination
- **WHEN** a combination chains `.orderBy(...).limit(3)`
- **THEN** the rendered `order by`/`limit` follow the LAST branch and
  govern the whole set, never a single branch

#### Scenario: Nesting composes
- **WHEN** `a.union(b).except(c)` compiles
- **THEN** the statement expresses `(a union b) except c` and renders
  each operator at its own nesting level

#### Scenario: A set-operation view round-trips
- **WHEN** `defineView` takes a union query and the declaration is
  snapshotted and read back
- **THEN** the diff against the unchanged declaration is empty and the
  view's column list equals the left branch's

#### Scenario: Branches with the same keys in a different order are refused
- **WHEN** two branches' projections list the same key set in a
  different order (e.g. `{email, city}` against `{city, email}`), via
  either the core builder or the query package's chain surface
- **THEN** the combinator call fails at build time, naming both
  branches' own key order and the first position at which they
  disagree, before either branch ever reaches the server

#### Scenario: A recursive CTE's anchor and recursive term are held to the same order rule
- **WHEN** `asRecursive`'s anchor and recursive term project the same
  key set in a different order
- **THEN** the call fails at build time the same way a plain union's
  branches would, naming both orders and the first disagreeing
  position — the recursive-term type rule alone does not catch this
  (it is `SameKeys`-based and cannot see order), so this guard is what
  does

#### Scenario: A hand-assembled set-op node bypasses the guard, and a decoded snapshot is not itself re-validated
- **WHEN** a `SetOpNode` is constructed directly (never through a
  combinator) or decoded from a stored snapshot
- **THEN** this guard, which runs only at combinator construction time,
  does not re-check it; a reordered branch reaching a view this way is
  a decode-path concern, not this guard's — a hand-edited snapshot is
  the one realistic way to reach it, and `hejbro verify` reports it as
  a hash mismatch when run

### Requirement: Recursive CTEs traverse
The builder SHALL support recursive CTEs: an anchor term, a `UNION` — with
or without `all`, both of which Postgres's grammar allows — and a
recursive term that may reference the CTE being defined. `recursive` SHALL
be a property of the `WITH` list, not of an entry, matching Postgres's
grammar: one `with recursive` covers every entry in the list and has no
effect on the entries that do not recurse.

A recursive branch SHALL NOT offer `intersect` or `except`, and SHALL NOT
carry a whole-set `order by`, `limit` or `offset`: Postgres refuses all
four, the first as a recursion-structure violation and the rest as
unimplemented features.

Everything Postgres's parser accepts in a recursive term SHALL remain
accepted here — `distinct`, `distinct on`, `group by`/`having`, `union`
as well as `union all`, and either materialization hint on a recursive
entry all parse and execute there. Two constructs carry a narrower claim,
each measured (harden-query-surface group 1), and the wording here is no
wider than what was measured: an aggregate is accepted in the **anchor**
term, not the recursive term — Postgres refuses an aggregate in the
recursive term itself (`42P19`, "aggregate functions are not allowed in a
recursive query's recursive term", measured, M1); a window function in
the recursive term is not refused at parse time, but the measured
construct (`row_number() over ()`, whose value does not advance with the
recursion) never terminates rather than returning a row (measured, M2) —
this is not evidence that window functions are illegal in a recursive
term, only that this particular construct does not complete, and the
builder does not refuse on Postgres's behalf either way. The commonly
recalled restriction list is wider than the database's actual one, and
refusing on it would make the builder stricter than Postgres.

The recursive term SHALL be written against a reference whose columns come
from the anchor term, so that the row shape is fixed before self-reference
is possible.

#### Scenario: A tree is walked
- **WHEN** a recursive CTE anchors on the roots of a self-referencing table
  and joins children in its recursive term
- **THEN** the compiled SQL carries `with recursive … union all …`, and the
  database returns every descendant

#### Scenario: A window function survives inside a recursive term
- **WHEN** a recursive term projects a window function
- **THEN** the statement is accepted at parse time, as Postgres accepts it
  — whether the specific window construct's recursion terminates is a
  property of that construct (measured, M2: `row_number() over ()` does
  not), not something this builder refuses on Postgres's behalf

#### Scenario: One recursive keyword covers the list
- **WHEN** a `WITH` list containing a recursive entry also contains a
  non-recursive one
- **THEN** the rendered SQL carries a single `with recursive`, with both
  entries under it

### Requirement: Selects aggregate and group
The builder SHALL provide the aggregate vocabulary — `count()`, `min`,
`max`, `sum`, `avg` — and the `groupBy` and `having` stages.

`groupBy` SHALL be available after `where` and SHALL require at least one
expression. `having` SHALL be available only after `groupBy`, and
`orderBy`/`limit`/`offset` SHALL still follow it: the chain admits
exactly SQL's own clause order, so a placement Postgres would reject is
not expressible.

Aggregates SHALL render as Postgres's own function names, with
`count()` rendering `count(*)`. There is no separate filtered-count
constructor: a `FILTER (WHERE …)` clause is not yet part of the
vocabulary (harden-query-surface, #469 — the invented name
`countWhere(expr)` covered that one use without generalizing to a real
`FILTER` clause, and was removed rather than kept; a real `FILTER (WHERE
…)` construct is tracked as a follow-up).

#### Scenario: Grouping with a group filter
- **WHEN** a select projects a column and `count()`, filters rows with
  `where`, groups by that column, filters groups with `having`, then
  orders and limits
- **THEN** the compiled SQL carries `where`, `group by`, `having`,
  `order by` and `limit` in that order, and the database returns only the
  groups `having` kept

#### Scenario: An empty group by is refused
- **WHEN** `groupBy()` is called with no expressions
- **THEN** it fails immediately, naming what to pass

#### Scenario: having is unavailable without grouping
- **WHEN** a chain has not called `groupBy`
- **THEN** `having` is not on that stage
