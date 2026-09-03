## MODIFIED Requirements

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

That union is available where both branches' row types are resolved
before they are combined, which is the chain surface. A set operation
built from the core builder's own combinators carries the LEFT branch's
projection and no type for the right branch at all, so executing one
through a db handle SHALL deliver the left branch's own declared row
shape — the keys this rule names, each with its declared read type —
never a raw driver row. On that form the widening above is not
expressible, because the type it would union is not carried; the keys
and the left branch's own types are.

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

#### Scenario: A core-built set operation executed on a handle reads back as its left branch
- **WHEN** a set operation built with the core builder's own combinators
  is executed through a db handle
- **THEN** the rows read back with the left branch's declared keys and
  read types, and no key resolves to an untyped driver row's value
