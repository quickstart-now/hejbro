## ADDED Requirements

### Requirement: Set-operation branches must agree in type family
A set-operation combinator — core's `union`/`intersect`/`except` family
and the chain's — and a recursive CTE's anchor/recursive-term pair
SHALL fail to type-check when, for one projected key, the two branches
resolve to different type families and that pair is one Postgres
refuses to unify in a set operation (`42804` or `42846` — the server's
two type-resolution refusals, "types … cannot be matched" and "could
not convert type"; the refused pairs are measured on the server and
carried as the test's input table, not assumed). A branch whose family
is `"unknown"` — a `sql` fragment, or a literal the type layer cannot
place — SHALL match every family on the other side: Postgres types such
an expression against the other branch at parse time, and the builder
SHALL NOT be stricter than the database. The pairs the server unifies
are the same-family ones and any pair with `"unknown"` on either side;
those SHALL stay accepted. A cross-family unification measured later is
added to the table, not to this sentence. The refusal is TypeScript's
own, at the combinator's parameter, exactly as a key-set mismatch is
refused today; no runtime check is added.

This rule sees families, not types. A divergence inside one family —
`integer` against `bigint`, `numeric` against `bigint` — is invisible
to it by construction and stays uncaught (#489); this requirement SHALL
NOT be read as closing that gap. The same granularity also lets through
the same-family pairs the server itself refuses — an array against an
array of a different element type (`text[]` against `integer[]`), a
time-of-day type (`time`, `timetz`) against a date or timestamp type,
`json` against `jsonb`, `macaddr` against `inet` or `cidr`, and an enum
against `text`, `varchar` or `char` — measured on postgres:17; they are
tracked as #977, and this requirement states the gap rather than
closing it.

#### Scenario: A refused pair fails to type-check
- **WHEN** a select projecting a `text` column unions a select
  projecting a `numeric` column under the same key — or any other pair
  the measured table marks refused — on the core builder, the chain,
  or as a recursive CTE's anchor and term
- **THEN** the program fails to type-check at the combinator's
  parameter, before any SQL the server would reject with `42804` or
  `42846` is compiled

#### Scenario: An untyped branch matches any family
- **WHEN** one branch's key is a `sql` fragment or an unplaceable
  literal (family `"unknown"`), on either side or both
- **THEN** the combination type-checks, and the compiled statement is
  the one Postgres accepts by typing the untyped side against the other

#### Scenario: A pair the server unifies stays accepted
- **WHEN** the two branches' families for a key are the same, or either
  side's family is `"unknown"` — the only pairs the server unifies
  (measured: no cross-family pair unifies on postgres:17)
- **THEN** the combinator accepts the branches and the key's result type
  is unchanged

#### Scenario: A family added without a row is caught
- **WHEN** a family is added to `sqlTypeFamilies` without a row in the
  measured table
- **THEN** the enumeration test fails, naming the family

#### Scenario: Within-family divergence is not this rule's
- **WHEN** an `integer` column unions a `bigint` column under one key
- **THEN** the program type-checks as before — the gap is #489's, and
  the reference says so beside this rule
