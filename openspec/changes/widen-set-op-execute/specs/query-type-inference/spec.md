## REMOVED Requirements

### Requirement: Set-operation branches must be row-compatible, and the result types honestly
**Reason**: two of its scenarios ("A core-built set operation executed
on a handle reads back as its left branch", "An object projection
widens where the join record is missing") describe the carve-out this
change removes — a core-built stage now carries both branches, so the
handle resolves the same union the chain does. The measured Postgres
facts and every other scenario move unchanged into the requirement
below.
**Migration**: none for callers; a core-built set operation's awaited
row type widens from the left branch's row to the branch union, which
every existing consumer already accepts.

## ADDED Requirements

### Requirement: Set-operation branches must be row-compatible, and the result types the union of both on every surface
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

That union SHALL hold on every surface that executes a set operation:
the chain, where both branches' row types are resolved before they are
combined, and a set operation built from the core builder's own
combinators executed through a db handle. A core-built stage carries
both branch stages, so each branch resolves to its own row — with its
own left-joined tracking — before the two are combined; a column is
nullable in the result because a branch declared it nullable or
left-joined its table, never because the record of what was joined is
missing. No key resolves to an untyped driver row's value.

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

#### Scenario: A core-built set operation executed on a handle reads back as the union of its branches
- **WHEN** a set operation built with the core builder's own combinators
  — whole-table or object projections, one column declared differently
  by each branch — is executed through a db handle
- **THEN** the rows read back with the left branch's keys, that column
  typed as the union of both branches' declared read types, and no key
  resolves to an untyped driver row's value — the same row the chain
  surface reads back for the same two branches

#### Scenario: A left-joined branch widens the core-built result, an inner-joined one does not
- **WHEN** one branch of a core-built set operation projects a column
  from a table it left-joined and the other branch inner-joins the same
  table, or neither branch joins at all
- **THEN** the column is nullable in the result exactly when a branch
  left-joined its table; a projection no branch left-joined is not
  widened to include null

#### Scenario: A nested core-built set operation resolves through its inner stage
- **WHEN** a core-built set operation nests another on either side —
  `(a union b) except c`, and `a except (b union c)` — and is executed
  through a db handle
- **THEN** each side resolves first, a nested side through its own inner
  stage, and the two combine by the same rule
