# query-builder (delta)

## MODIFIED Requirements

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
