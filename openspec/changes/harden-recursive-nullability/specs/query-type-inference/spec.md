## MODIFIED Requirements

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
row type is the anchor's — in its types. Its nullability is not: a key
SHALL read back as nullable through the CTE's outward reference when
either branch projects it nullable, because a `null` the recursive term
produces reaches the result rows and Postgres resolves no nullability
at all. The reference the recursive term itself is written against
stays typed from the anchor alone. Requiring the two projections to be identical
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
  type — nullable when the recursive term's projection is nullable, as a
  windowed projection is — and how the recursive term computes it is
  otherwise not part of the CTE's row type

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

The elision is the test's; the outward row type does not inherit it.
An anchor projecting a non-null value and a recursive term projecting a
nullable value for the SAME key still type-checks, and the recursive
term's null genuinely reaches the result rows — so the CTE's outward
row type SHALL carry that key as nullable: the anchor's type, widened
by the recursive term's nullability, the same per-key union a plain
set operation's result already has. The rule that the row type is the
anchor's governs the *type* (which Postgres resolves and enforces with
`42804`); nullability is a dimension Postgres never resolves, so the
anchor's non-null claim was hejbro's own inference and is not made.

Elision covers nullability only. A `.$type<T>()` brand (a TS-only tag on
a column's declared type, invisible to Postgres) is a separate axis this
requirement does not elide or otherwise address — a stated boundary
rather than a silently dropped case.

#### Scenario: A recursive term nullable where the anchor is not still compiles
- **WHEN** the anchor projects a non-null value for a key and the
  recursive term projects a nullable value for the same key, with no
  other type divergence
- **THEN** it type-checks, the reference inside the recursive callback
  still shows the anchor's non-null type for that key, and the CTE's
  outward row type shows it as nullable — the type a null value from the
  recursive term, which genuinely reaches the result rows (measured),
  requires; a key non-null in both branches stays non-null, and a key
  nullable in the anchor is nullable outward whatever the recursive term
  projects
