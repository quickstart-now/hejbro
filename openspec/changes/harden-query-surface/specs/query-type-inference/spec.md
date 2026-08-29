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
rule and would reject the constructs Postgres accepts in a recursive term:
a field the anchor reads straight from a column and the recursive term
computes with a window function or an aggregate has a different type on
each side and is legal on both.

This check holds in the core builder, where the recursive term is written.
A plain `union()` in the core builder does **not** carry it today — that
rule has only ever been wired into the chain surface — so a mismatched
plain union still builds and fails on the server. That gap is #487's, not
this change's: the compatibility type moves into core here, which is most
of what closing it needs, but wiring it into `union()` changes a surface
D103 settled and belongs to its own change.

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
