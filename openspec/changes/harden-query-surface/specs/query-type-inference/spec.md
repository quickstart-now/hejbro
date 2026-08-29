# query-type-inference (delta)

## MODIFIED Requirements

### Requirement: A recursive term is typed from its anchor
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
row type is the anchor's.
Requiring the two projections to be identical would be stricter than that
rule and would reject constructs Postgres genuinely accepts in a
recursive term — but not every differently-computed field is such a
construct, and this requirement does not claim the category is safe, only
the two divergences it was actually measured against. An aggregate
computing a shared key in the recursive term is refused outright
(`42P19`, "aggregate functions are not allowed in a recursive query's
recursive term" — harden-query-surface group 1, M1); a window function
computing it is not refused at parse time, but the measured construct
(`row_number() over ()`, whose value does not advance with the recursion)
never terminates rather than returning a row (measured, M2). Neither is
evidence that a recursive term may compute a shared key with a window
function or an aggregate, and this requirement makes no such claim. What
the relaxation from "identical" to "compatible" is actually justified by
are two divergences group 1 measured as accepted: a key nullable in the
recursive term where the anchor's is not (M4), and a same-family declared-
type divergence that resolves through the anchor's own type (M3b-i,
`numeric` anchor + `bigint` recursive term) — both are their own scenarios
below.

This check holds in the core builder, where the recursive term is
written, and — since harden-query-surface group 3 — in a plain `union()`
there too: the same compatibility test now gates every set-op combinator
core provides (`union`/`unionAll`/`intersect`/`intersectAll`/`except`/
`exceptAll`), not only the recursive-term case, closing the gap this
requirement used to park at #487. The query package's own chain surface
carries the identical check independently (D103, predating this change).

The compatibility test elides nullability when comparing the anchor's and
the recursive term's projected keys — a rule tightened to require an exact
type match would count a nullable value against a non-null one and reject
constructs Postgres accepts. This is deliberate, not an oversight, and it
leaves a known, measured residue: an anchor projecting a non-null value
and a recursive term projecting a nullable value for the SAME key still
type-checks, and the CTE's declared row type stays the anchor's (non-null)
— but the recursive term's null genuinely reaches the result rows
(harden-query-surface group 1, M4 addendum: a recursive term yielding
`null::int` against a non-null `int` anchor is accepted by postgres:17,
`pg_typeof` stays `integer` on every row, and the null arrives in the
result rows). The unsoundness here is hejbro's own — the type system
infers non-null and that inference is what is wrong, not anything
Postgres does; no measured query carried a `NOT NULL` constraint, so this
is not "Postgres ignores the anchor's `NOT NULL`". Narrowing this further
(widening the declared row type to the anchor's type plus the recursive
term's own nullability) would contradict the pinned rule just above that
the row type is always the anchor's — that is its own design question,
tracked at #500 (a `#412` sub-issue), not settled here.

Elision covers nullability only. A `.$type<T>()` brand (a TS-only tag on
a column's declared type, invisible to Postgres) is a separate axis this
requirement does not elide or otherwise address — out of scope here,
recorded so it is a stated boundary rather than a silently dropped case
that resurfaces the next time a recursive CTE carries a branded column.

A second axis, the recursive term's declared TYPE (as opposed to whether
it is nullable), is measured to be **directional** and is not caught.
Group 1 measured the identical type pair with the anchor/recursive-term
sides reversed: `numeric` anchor + `bigint` recursive term is accepted
and resolves to `numeric` (M3b-i); `bigint` anchor + `numeric` recursive
term — the same pair, reversed — is refused with `42804` (M3b-ii). Same
two types, opposite verdicts depending on which side is the anchor: the
failure condition is "the recursive term's resolved type differs from
the anchor's", not "the two declared types differ", and Postgres's own
implicit-cast resolution decides it, not a symmetric equality test. This
is not expressible as a build-time TypeScript check without reproducing
that resolution table: this package's own `SqlTypeFamily` collapses
`smallint`/`integer`/`bigint`/`real`/`double precision`/`numeric`/the
`serial` family into one family, `"numeric"` — the same family both
M3b-i's and M3b-ii's branches share, so nothing at the family level (the
coarsest type information a `keyof`-based compatibility check has
access to) can tell the accepted pair from the refused one. A same-
family type divergence on a shared key — including the exact M3b-ii
shape — therefore still type-checks today and can fail on the server
instead of at build time. Tracked at #489, which this requirement
narrows without closing: the key-SET axis is checked at build time
(refused when it disagrees) and the nullability axis is deliberately
elided (accepted on purpose, its own residue stated above); this
declared-type axis is neither — it is simply not reachable by a
`keyof`-based check, and is left open rather than claimed closed.

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

#### Scenario: A recursive term nullable where the anchor is not still compiles
- **WHEN** the anchor projects a non-null value for a key and the
  recursive term projects a nullable value for the same key, with no
  other type divergence
- **THEN** it type-checks, and the CTE's declared row type is the
  anchor's non-null type — even though a null value from the recursive
  term can genuinely reach the result rows (measured, #500)

#### Scenario: A same-family type divergence between anchor and recursive term is not caught
- **WHEN** the anchor and the recursive term project the same key with
  two different declared types that share one `SqlTypeFamily` (e.g.
  `numeric` and `bigint`, both family `"numeric"`)
- **THEN** it type-checks regardless of which side is the anchor —
  Postgres's own directional resolution (accepting one order, refusing
  the reversed order with `42804`, measured) is not reproduced here
  (#489)

### Requirement: Set-operation branches must be row-compatible, and the result types honestly
A set-operation combinator SHALL fail to type-check when the two
branches' result rows carry different key sets.

This is not a rule the server imposes. Postgres matches set-operation
branches by **position and type**, never by name — measured twice, from
two different angles. Harden-query-surface group 8: unioning
`{email, city}` against the same key SET reordered to `{city, email}`
compiles and executes, and the combined result keeps the LEFT branch's
own column names while the values underneath came from the wrong
position. Harden-query-surface group 7, M6: a plain two-column union
whose branches' column NAMES genuinely differ at both positions
(`select a.email, a.city from a union select b.login, b.town from b`, no
common name at either position) still compiles and executes, and the
combined result again keeps the left branch's own names (`email, city`,
confirmed both from the query directly and from `information_schema.
columns` behind a view over it) — with a positive control alongside it
(a genuine type mismatch at a position, `42804`) confirming the
instrument reports a real refusal when there is one, so the acceptance
above is not the silence of a broken check. Together the two measurements
cover both ways a key set can diverge from an exact match — same set,
different order (group 8) and genuinely different names (M6) — and
Postgres refuses neither. The refusal this requirement imposes is
TypeScript's own: a `SelectProjection` is keyed by name, so a branch pair
whose key sets differ has no honest single row type to assign —
reconciling it would mean inventing a value for a key one branch never
projects, or silently dropping a key the other branch does. Failing to
type-check is more honest than either, which is the actual justification,
not a claim that the database would refuse the statement.

The combined result row SHALL take the LEFT branch's keys — SQL's own
naming rule, demonstrated by both measurements above (the combined result
kept the left branch's own column names in each) — with each column's
type the union of the two branches' declared read types for that key
(identical declarations stay unchanged), and a column nullable in EITHER
branch SHALL be nullable in the result.

#### Scenario: Identical branch shapes pass through unchanged
- **WHEN** two whole-table selects over identically-declared tables
  combine with `.union(...)`
- **THEN** the awaited row type equals the single-select row type

#### Scenario: Mismatched keys are rejected at compile time
- **WHEN** a select over `{ id, name }` unions a select over
  `{ id, title }`
- **THEN** the program fails to type-check even though the server itself
  would accept the equivalent hand-written SQL (measured, M6) — the
  refusal is TypeScript's own name-keyed row type having no single honest
  shape to assign when a key set differs, not a claim about what the
  server does

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
  Postgres's `count` is `int8` whatever it counted.
- `min(expr)`/`max(expr)` SHALL type and convert as their argument does,
  which is what Postgres returns for them.
- `sum(expr)`/`avg(expr)` SHALL type as the numeric family's widest
  honest type. Postgres promotes their result by the argument's exact
  type, so a single declared result type would be wrong for most inputs;
  widening is the honest answer until that promotion is modeled.

There is no separate filtered-count constructor: `count()`'s own
`FILTER (WHERE …)` form is not yet part of the builder's vocabulary
(harden-query-surface, #469 — an invented name, `countWhere(expr)`,
covered a use no other constructor's name pattern generalized to, and
was removed rather than kept; a real `FILTER (WHERE …)` clause is
tracked as a follow-up rather than shipped under that name).

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
