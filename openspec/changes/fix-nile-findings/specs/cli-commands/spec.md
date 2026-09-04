## MODIFIED Requirements

### Requirement: An expression is compared through the server's own rendering
Where `check` compares an expression through the server's rendering — a
check constraint's expression — it SHALL obtain the rendering of **both**
the declared expression and the database's own expression from **one
statement**, and compare those. An index's predicate and a generated
column's expression are not compared this way: an index is compared by
its existence and a generated column by its default text, so neither
reaches this requirement's comparison, and extending it to them is a
separate change.

One statement, not two sent to one connection: a driver is free to pool
connections, so two statements can land on two sessions whose
`search_path` or other settings differ, and the deparse this comparison
rests on is sensitive to exactly those settings. "Same session" is
unenforceable from outside the driver — a single statement makes it true
by construction instead, and costs a round trip less. It also stays
within the no-capability rule: pinning a connection any other way means a
transaction.

Comparing hejbro's rendered text against the catalog's text directly is
not permitted where a rendering can be obtained. Postgres rewrites an
expression when it stores it, so the two texts differ for expressions
that agree: measured against `examples/postgres`, 8 of 8 check
constraints differed textually while being identical in meaning.

This comparison is syntactic equality of the server's own rendering. It
is not a proof of semantic equivalence, and reordered operands are
reported as a difference — hejbro's own snapshot diff treats a reordered
declaration as a change too.

The rendering SHALL be obtained in a way that does not depend on how the
database chooses to execute anything, and that row-level security cannot
suppress. An expression compared as a query *predicate* fails both:
the planner may place it differently depending on the indexes and
statistics that happen to exist, and row-security rewriting can remove it
entirely, which makes two genuinely different expressions compare equal.

On a platform whose registered preset declares that the server cannot
plan a statement, no rendering can be obtained. There, and only there,
`check` SHALL compare the declared check constraint's text with the
catalog's own text after a fixed normalization — whitespace outside
string literals, one parenthesis pair enclosing the whole text, the
enclosing table's qualifier on a column reference, identifier quoting
where the identifier would render unquoted anyway, a type cast the
server appended to a string literal, and letter case outside quoted
identifiers and string literals — and nothing else. Texts equal after
that normalization SHALL count as agreeing. Texts that still differ SHALL
be reported as **not compared**, carrying both texts and a `Next:` that
names restating the declaration in the catalog's own spelling; they SHALL
NOT be reported as differing, because a textual difference is not
evidence of a different meaning. The `Next:` line SHALL NOT ask the user
to run or be granted `EXPLAIN` on such a platform. The report's coverage
boundary SHALL state that the run compared check-constraint expressions
by normalized text. On a platform whose presets make no such
declaration, a failure to obtain the rendering remains reported exactly
as before.

Whether the database **enforces** a check constraint is compared
separately from its expression. A constraint the database is not
enforcing on existing rows states a weaker invariant than the declaration
claims, and its expression matches all the same.

#### Scenario: An expression that differs only by Postgres's rewriting passes
- **WHEN** a declared check constraint uses `in (...)` or `between`, and
  the database stores the rewritten form
- **THEN** `check` reports no difference for that constraint

#### Scenario: An expression that genuinely differs is reported
- **WHEN** a declared check constraint bounds a column at 5 and the
  database's constraint bounds it at 4
- **THEN** `check` reports that constraint as differing

#### Scenario: Row-level security does not hide a difference
- **WHEN** the connected role has no policy on the table an expression
  belongs to, and that expression genuinely differs
- **THEN** `check` still reports it as differing, rather than reporting
  agreement because the database declined to evaluate anything

#### Scenario: A constraint the database does not enforce is reported
- **WHEN** the database holds a declared check constraint as `NOT VALID`
- **THEN** `check` reports it, stating that existing rows are not
  enforced, even though its expression matches the declaration

#### Scenario: Under a preset that declares no planning, equal normalized texts agree
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders
  `length(btrim("projects"."name")) > 0`, and the catalog holds
  `(length(btrim(name)) > 0)`
- **THEN** `check` reports no difference for that constraint, and its
  coverage boundary states that check-constraint expressions were
  compared by normalized text on this run

#### Scenario: Under a preset that declares no planning, a rewritten expression is not compared
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"role" in ('owner', 'admin')`, and
  the catalog holds `(role = ANY (ARRAY['owner'::text, 'admin'::text]))`
- **THEN** `check` reports that constraint as not compared, carrying
  both texts, with a `Next:` that names restating the declaration in the
  catalog's spelling and never mentions `EXPLAIN`, and the run does not
  exit zero

#### Scenario: Under a preset that declares no planning, a string literal's content is never normalized
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"projects"."format" <> '"json"'`,
  and the catalog holds `(format <> 'json'::text)`
- **THEN** `check` reports that constraint as not compared: no
  normalization step rewrites the inside of a string literal, so the
  quoted word in the literal and the qualifier-like text a literal may
  carry stay exactly as written on both sides

#### Scenario: Under a preset that declares no planning, a failed catalog read is not compared without asking for EXPLAIN
- **WHEN** a registered preset declares the platform cannot plan a
  statement, and reading the constraint's own expression from
  `pg_constraint` fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, and its `Next:` names the catalog read to confirm
  and never asks the user to run or be granted `EXPLAIN`

#### Scenario: Without such a declaration, a failed rendering is reported as before
- **WHEN** no registered preset declares the platform cannot plan a
  statement, and the rendering statement fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, exactly as it does today, and never compares by
  text

## ADDED Requirements

### Requirement: A preset declares whether its platform can plan a statement
A provider preset SHALL be able to declare that its platform cannot plan
a statement — that `EXPLAIN` is not available — as data on the preset
value (`explainUnavailable: true`), fixed before any connection exists
and never discovered by probing the server. Its absence SHALL mean the
platform can plan, so no existing preset changes meaning by staying
silent. `check` SHALL read the declaration from the presets the
configuration registers, and from nowhere else: the connection `check`
opens is the vanilla driver's, so a declaration on a preset's driver
would never reach it.

The Nile preset SHALL carry the declaration.

#### Scenario: The declaration is readable as data
- **WHEN** a preset value declaring `explainUnavailable` is examined
  before any connection is made
- **THEN** the declaration is present as data, and nothing was sent to a
  server to establish it

#### Scenario: Silence means the platform can plan
- **WHEN** `check` runs with presets that make no such declaration
- **THEN** it compares expressions through the server's own rendering,
  exactly as before

#### Scenario: The Nile preset declares it
- **WHEN** the Nile preset value is examined
- **THEN** it declares `explainUnavailable`
