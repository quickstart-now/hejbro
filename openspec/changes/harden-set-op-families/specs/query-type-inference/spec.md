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
place — SHALL match every family on the other side: the type layer
cannot see what type such an expression has, and this rule SHALL refuse
only what it can prove the server refuses. What the server does with it
afterwards is the server's: an untyped literal is resolved against the
other branch, while a fragment the server types on its own is compared
there and may be refused. The pairs the server unifies
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
array whose element types are themselves a pair the server refuses
(`text[]` against `integer[]`, `time[]` against `timestamptz[]`; arrays
unify exactly when their elements do), an enum against `text`,
`varchar`, `char`, or a different enum type, a time-of-day type
(`time`, `timetz`) against a date or timestamp type, `json` against
`jsonb`, `macaddr` against `inet` or `cidr` — measured on postgres:17;
they are tracked as #977, and this requirement states the gap rather
than closing it.

#### Scenario: A refused pair fails to type-check
- **WHEN** a select projecting a `text` column unions a select
  projecting a `numeric` column under the same key — or any other pair
  the measured table marks refused — on the core builder, the chain,
  or as a recursive CTE's anchor and term
- **THEN** the program fails to type-check at the combinator's
  parameter, before any SQL the server would reject with `42804` or
  `42846` is compiled

#### Scenario: An expression the server leaves untyped is resolved against the other branch
- **WHEN** one branch's key is an expression Postgres itself leaves
  untyped — a quoted literal, `NULL` — on either side or both
- **THEN** the combination type-checks, and the compiled statement is
  the one Postgres accepts by typing the untyped side against the other

#### Scenario: A `sql` fragment is accepted because the type layer cannot see it
- **WHEN** one branch's key is a `sql` fragment, whose family is
  `"unknown"` because this layer cannot place it
- **THEN** the combination type-checks — this rule refuses only what it
  can prove the server refuses — and a fragment the server types on its
  own (`sql` with `1`, `now()`) is compared by the server and may be
  refused there

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
