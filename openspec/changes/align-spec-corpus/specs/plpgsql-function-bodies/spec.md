# plpgsql-function-bodies Delta

## MODIFIED Requirements

### Requirement: A trigger body returns a row, never a query
A trigger body that returns a query SHALL fail at declaration time with a
named error whose `Next:` clause names the trigger's own form — execute
the statement for its effect, then return the trigger row. This is the
trigger-specific case of the return-shape requirement ("A body's return
shape is decided by the declaration"), stated separately because its
diagnostic and remedy are the trigger's own; it adds no shape the general
rule does not already refuse.

#### Scenario: A query returned from a trigger body is refused
- **WHEN** a trigger body returns a query
- **THEN** the declaration fails with a named error whose `Next:` clause
  names the trigger's own form — execute the statement for its effect,
  then return the trigger row

### Requirement: A builder a body makes is a builder a body uses
A statement builder constructed while a body is being recorded SHALL
reach a consumer, and a declaration whose body leaves one unconsumed
SHALL fail at declaration time with a named error rather than generating
a function missing that statement.

The rule is *created and not consumed* — never "not returned". A builder
reaches `ctx.return` in only some of its legitimate uses: it can be a row
source, a loop's query, an executed statement, a subquery inside an
expression, one side of a set operation, or a view's definition, and none
of those pass it to `ctx.return`.

So the contract is stated over consumers, not over a list of them: **any
function that takes a statement builder as an argument SHALL mark it
consumed**, and a stage built from another builder SHALL supersede the
one it was built from. A set-operation combinator does both at once — it
consumes its argument and supersedes its receiver. A consumer added later
without marking consumption turns correct declarations into failures, so
marking it is part of adding one; this is the requirement rather than a
convention precisely because the cost of forgetting lands on the user, in
code that was always valid.

Consumption is not exclusive and not ordered: a builder consumed twice is
consumed — the statement simply renders twice, which Postgres accepts and
hejbro therefore does not refuse. Judgment happens when recording ends,
because nothing consumed after that point can reach the generated body.

The criterion is consumption, never syntax. Holding a builder in a
variable, returning one from a helper function, or collecting several in
an array is not what fails; a builder nothing ever consumed is. A helper
called from a body whose result is passed to `ctx.execute` consumes its
builder like any other call, and a body that builds an array of
statements and executes each of them consumes all of them.

Detection SHALL be gated on an open recording session. The same builder
factories serve `@hejbro/query`'s runtime chain, which builds statements
on every executed query and is not declaring anything; outside a
recording session no builder is tracked.

That gate has a consequence worth stating rather than leaving to be
discovered: a builder constructed *before* a body runs — at module scope,
say — is never observed, so it is neither reported when a body consumes
it (correct) nor reported when nothing does (the guard's one blind spot).
The guard covers what a body builds, not what a body is handed.

#### Scenario: A statement built and dropped fails the declaration
- **WHEN** a trigger body constructs an insert and never passes it to
  `ctx.execute` or `ctx.return`
- **THEN** the declaration fails with `statement-builder-unused`, naming
  the statement kind and pointing at `ctx.execute` — rather than
  generating a body in which the insert never appears

#### Scenario: A chain's intermediate stages are not reported
- **WHEN** a body returns a query built through several chained stages
- **THEN** the declaration succeeds: each stage is superseded by the one
  built from it, and only a stage nothing was built from could be unused

#### Scenario: A select consumed as an expression is not reported
- **WHEN** a body returns a query whose condition wraps another select in
  `exists(...)`
- **THEN** the declaration succeeds — the inner select was consumed, not
  abandoned

#### Scenario: A failure names a form the body actually accepts
- **WHEN** a body builds a set operation, which no body statement can
  carry today — `ctx.return`, `ctx.row` and `ctx.execute` all take a
  select, an insert, an update or a delete
- **THEN** the failure says the body has no statement that carries a set
  operation, instead of pointing at `ctx.execute`, which would send the
  user to a call that does not accept one

#### Scenario: The runtime query chain is unaffected
- **WHEN** a query is built through `@hejbro/query` with no body being
  recorded
- **THEN** no builder is tracked and no declaration-time check runs

#### Scenario: A failed declaration does not contaminate the next one
- **WHEN** a declaration fails while its body is being recorded, and
  another declaration is made afterwards
- **THEN** the second declaration sees none of the first's builders — a
  diagnostic never names a body other than the one it came from

#### Scenario: Of two builders built ahead of a choice, the unchosen one fails
- **WHEN** a body constructs two statement builders and passes only one
  of them to `ctx.return`
- **THEN** the declaration fails for the *other* one, and the failure
  names the form that keeps both paths — building inside the chosen
  branch (`ctx.return(flag ? update(…) : deleteFrom(…))`), which
  expresses the same thing and drops nothing

#### Scenario: A builder from a helper is consumed like any other
- **WHEN** a body calls a helper that constructs a statement and passes
  the result to `ctx.execute`
- **THEN** the declaration succeeds — where the builder was constructed
  does not matter, only that something consumed it
