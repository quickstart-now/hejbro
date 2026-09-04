# plpgsql-function-bodies Specification

## Purpose

The plpgsql bodies hejbro generates for declared functions and
triggers: how a body's `ctx.return(...)` is checked against the
enclosing declaration's own return shape at declaration time, so a
body Postgres would reject at apply time — or only on the function's
first call — fails while the mistake is still cheap.

## Requirements

### Requirement: A body's return shape is decided by the declaration
`ctx.return(...)` SHALL accept exactly the shape the enclosing
declaration's own `returns` can carry, and SHALL reject any other shape
at declaration time with a named error rather than emitting SQL the
database refuses:

- `returns` a table (`returns setof …`) — a query; renders `return query …;`
- the trigger sentinel (`defineTrigger`) — a trigger row (`new`/`old`);
  renders `return <ref>;`
- `returns` a scalar type — an expression (a column reference, an
  argument reference, or a `sql` fragment); renders `return <expr>;`

A scalar-returning declaration whose body records no return at all SHALL
also fail at declaration time: Postgres accepts such a `CREATE` and
raises only when the function is first called, so the declaration is the
last place the mistake is cheap.

#### Scenario: A scalar function returns an expression
- **WHEN** a function declared with a scalar `returns` type returns an
  expression from its body
- **THEN** the generated function body carries `return <expr>;` and the
  function's `returns` clause is that scalar type

#### Scenario: A query returned from a scalar function is refused
- **WHEN** a function declared with a scalar `returns` type returns a
  query
- **THEN** the declaration fails with `scalar-return-expects-expression`,
  naming the expression forms it accepts — rather than emitting
  `return query …`, which Postgres rejects at apply time with "cannot use
  RETURN QUERY in a non-SETOF function"

#### Scenario: An expression returned from a setof or trigger body is refused
- **WHEN** a function returning `setof <table>`, or a trigger body,
  returns a scalar expression
- **THEN** the declaration fails with
  `scalar-return-in-non-scalar-function`, naming the shape that
  declaration does accept

#### Scenario: A scalar function that never returns is refused
- **WHEN** a function declared with a scalar `returns` type has a body
  that never calls `ctx.return(...)`
- **THEN** the declaration fails with `scalar-return-missing` rather than
  generating a function that raises "control reached end of function
  without RETURN" on its first call

### Requirement: Return-value dispatch is decided by brands, not property names
`ctx.return(...)` SHALL identify which of the three shapes it received by
each shape's own brand, never by probing for a property name a user's
declaration could also carry. A trigger row is recognized by its trigger
brand before any expression check runs, so a table with a column named
after an internal expression field (`exprNode`) SHALL still return the
trigger row as a row reference.

The shape errors this dispatch raises SHALL be unchanged: a trigger row
returned from a scalar-returning declaration still fails with
`scalar-return-expects-expression`, and an expression returned from a
setof or trigger body still fails with
`scalar-return-in-non-scalar-function`.

This is a requirement rather than an implementation note because the
failure it forbids depends on the user's own data: a table with a column
named after an internal field made `ctx.return(ctx.new)` mean something
different, for that user only. Written down, it also outlasts the fix —
a later refactor that reorders the dispatch has a requirement to fail
against, not just a test name.

#### Scenario: A column named like an internal field does not hijack dispatch
- **WHEN** a trigger body calls `ctx.return(ctx.new)` on a table that has
  a column named `exprNode`
- **THEN** the body renders `return new;` — the trigger row is recognized
  by its brand, not mistaken for an expression

#### Scenario: Shape errors survive the reordering
- **WHEN** a scalar-returning declaration returns a trigger row
- **THEN** it still fails with `scalar-return-expects-expression`

### Requirement: A body executes statements for their effect
A body SHALL be able to run a statement for its side effect through
`ctx.execute(...)`, recorded in body order alongside the statements
already available, and rendered in the spelling plpgsql requires for that
statement:

- a select renders `perform <sql>;` — plpgsql rejects a bare `SELECT`
  that has no `INTO` clause, and `PERFORM` is the form it accepts
- an insert, update or delete renders `<sql>;`

Ordering is the body's own: an executed statement appears where the
declaration put it, before or after the return, inside an `if` branch or
a loop body, exactly as the recorded frame holds it.

#### Scenario: An audit insert runs in a trigger body
- **WHEN** a trigger body executes an insert and then returns its trigger
  row
- **THEN** the generated body carries the insert statement followed by
  `return new;`, in that order

#### Scenario: A select executed for effect becomes perform
- **WHEN** a body executes a select
- **THEN** the generated body carries `perform <sql>;`, not a bare
  `select`, which plpgsql refuses without an `into` clause

### Requirement: A returning mutation is refused where Postgres refuses it
`ctx.execute(...)` SHALL reject a mutation that carries `.returning()`,
at declaration time, with a named error. Postgres requires a command that
returns rows to consume them with an `INTO` clause; hejbro neither
invents an `INTO` target the declaration did not ask for, nor emits a
statement the database rejects.

This rejection is the database's, relayed. hejbro does not become
stricter than Postgres: every statement this refuses is one Postgres
refuses too, and the error names the forms that do work.

#### Scenario: An executed insert with returning is refused
- **WHEN** a body executes an insert whose chain ends in `.returning()`
- **THEN** the declaration fails with `execute-expects-no-returning`,
  naming both accepted forms — drop the `.returning()` to run the insert
  for effect, or return the query when its rows are the function's result

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
  carry — `ctx.return`, `ctx.row` and `ctx.execute` all take a
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

### Requirement: A body condition accepts what a query condition accepts
`ctx.if` and `elseIf` SHALL accept the same `Condition` union the
query-side condition positions accept — `Expr<"boolean"> |
Expr<"unknown">` — so a `sql` fragment reads as a condition in a body
exactly as it does in a `where`.

#### Scenario: A sql fragment is a body condition
- **WHEN** a body branches on a `sql` fragment
- **THEN** the declaration type-checks and the branch renders, matching
  what the same fragment does in `where(...)`

### Requirement: A scalar return expression's family is checked against the declaration
`ctx.return(<expr>)` in a scalar-returning declaration SHALL compare the
expression's type family against the declared `returns` type's family at
declaration time, and SHALL fail with `scalar-return-family-mismatch` —
naming both families in its `Next:` — exactly when the pair is one whose
plpgsql `RETURN` coercion fails for every value: Postgres accepts the
`CREATE` and every call of such a function then fails to convert the
returned value.

hejbro SHALL NOT become stricter than Postgres. A pair Postgres accepts
for some values SHALL stay accepted (`20260101` is a valid ISO date, so
a numeric expression may be returned as a datetime; `{}` prints as both
an empty JSON object and an empty array literal; inet input accepts
partial addresses like `42.5`). An expression of unknown family (a `sql`
fragment) SHALL never be refused, a same-family pair SHALL never be
refused, and a declaration whose `returns` family is text or bytea SHALL
never refuse — both accept every family through Postgres's IO
conversion (an enum return, though text-family, accepts only its own
labels; it stays unrefused on the safe side rather than by that
argument).

The check is family-granular by construction: an expression carries only
its coarse type family, so a within-family mismatch (`returns: time()`
returning a date column) is outside this check's reach and remains a
first-call failure. The boundary is the type information the expression
itself carries.

#### Scenario: A uuid expression returned as integer is refused
- **WHEN** a function declared with `returns: integer()` returns a
  uuid-family expression from its body
- **THEN** the declaration fails with `scalar-return-family-mismatch`,
  naming the returned family (uuid) and the declared family (numeric) —
  rather than generating a function whose every call fails to convert
  the value

#### Scenario: A value-dependent pair is not refused
- **WHEN** a function declared with a datetime `returns` type returns a
  numeric expression
- **THEN** the declaration succeeds — Postgres accepts some numeric
  values there, and hejbro does not refuse what Postgres might accept

#### Scenario: A sql fragment return is never family-checked
- **WHEN** a scalar-returning declaration returns a `sql` fragment
- **THEN** the declaration succeeds regardless of the declared family —
  an unknown-family expression makes no claim to check

#### Scenario: A text-returning declaration accepts every family
- **WHEN** a function declared with `returns: text()` returns a
  boolean-family expression
- **THEN** the declaration succeeds — every family reaches text through
  IO conversion

### Requirement: A returned mutation carries a returning clause
`ctx.return(...)` SHALL accept a mutation only when its chain ends in a
bare `.returning()` and SHALL refuse one that does not: in the type it
accepts, and, for a caller that reaches it with the type bypassed, at
declaration time with `return-expects-returning`. That declaration-time
refusal is reached only by a `setof <table>` body: a scalar body fails
earlier with `scalar-return-expects-expression` and a trigger body with
`trigger-return-expects-row`, in that fixed order.

A body's `return query …` needs a command that produces rows. A mutation
with no `RETURNING` clause produces none: Postgres accepts the function
at creation and rejects the body only when it is called (`INSERT query
does not return tuples`) — the declaration is the earliest place the
mistake can be named.

This is the mirror of the rule `ctx.execute` already carries: the
returning form is `ctx.return`'s, the non-returning form is
`ctx.execute`'s, and each refuses the other's. `ctx.execute` keeps
accepting a mutation at either stage, and keeps refusing the one that
carries `.returning()` with its own error.

#### Scenario: A mutation with no returning cannot be returned
- **WHEN** the body of a function returning `setof <table>` returns an
  insert, an update or a delete whose chain does not end in
  `.returning()`
- **THEN** the declaration does not type-check, and a caller reaching the
  recorder with the type bypassed fails with `return-expects-returning`,
  naming the statement kind and both forms that work — add `.returning()`
  when the rows are the function's result, or run the statement with
  `ctx.execute` for its effect

#### Scenario: A returning mutation is returned as before
- **WHEN** such a body returns an insert, an update or a delete on the
  declared table ending in a bare `.returning()`
- **THEN** the declaration compiles and the body renders
  `return query <sql>;`, carrying that statement's own whole-row
  `RETURNING` list

#### Scenario: An executed mutation is unaffected
- **WHEN** a body executes a mutation that never called `.returning()`
  through `ctx.execute`
- **THEN** the declaration compiles and the statement renders for its
  effect — what `ctx.execute` accepts is not narrowed by this rule

### Requirement: A local name is never one plpgsql declares itself
A name hejbro renders unquoted inside a function body — an argument's
derived SQL name, the scalar locals a row read declares, a loop's record
name — SHALL be refused at declaration time with `reserved-local-name`
when it is a name Postgres reserves or plpgsql declares itself. The
class is defined by its source, not by how it fails:

- a name Postgres reserves — its own keyword table's categories `R`
  (reserved) and `T` (reserved, usable as a function or type name) —
  or plpgsql reserves for its own statements;
- a variable plpgsql declares on its own — `found` in every function,
  `sqlstate` and `sqlerrm` inside an exception handler, and the
  variables a trigger function receives: `tg_name`, `tg_when`,
  `tg_level`, `tg_op`, `tg_relid`, `tg_relname`, `tg_table_name`,
  `tg_table_schema`, `tg_nargs`, `tg_argv`, `tg_event`, `tg_tag`.

A local by such a name either fails somewhere in the body or silently
changes what the name means, so hejbro refuses it before the body
reaches the server. Where the failure lands varies by name: a reserved
keyword breaks at creation — at the declaration, at an assignment, or
at a read of the name, depending on its category — while a variable
plpgsql declares is created without complaint and then plpgsql's own
wins: an argument named `found` is unreachable — `return found` yields
plpgsql's `FOUND`, not the caller's value — and only a `declare`d local
by that name hides plpgsql's, so a body that tests it after a statement
reads a variable the statement never set. `current_schema`,
alone among the keywords, is created without complaint too and then
resolves to the builtin in every expression position, and to the local
only where plpgsql binds it directly — a `select … into` target or
`return` — so an argument by that name is silently replaced by the
schema name inside a `where`. The declaration is the only place
every one of these is visible.

The refusal is uniform. A name is refused wherever a body would render
it and in every function alike — a `tg_*` name is refused in a plain
function as much as in a trigger — so that one list, one check and one
message serve every declaration. The comparison is by the spelling
Postgres resolves: an unquoted identifier folds to lower case, so a name
that differs from an owned one only by letter case is that name and is
refused the same way.

#### Scenario: A variable plpgsql declares itself is refused as an argument name
- **WHEN** a function declares an argument whose derived SQL name is
  `found`, `sqlstate`, `sqlerrm`, or any of the twelve `tg_*` variables
- **THEN** the declaration fails with `reserved-local-name`, naming the
  function and the name, and no declaration is produced

#### Scenario: A variable plpgsql declares itself is refused as a loop name
- **WHEN** a body names a `ctx.forEach` loop with one of those names, in
  any letter case — `found`, `FOUND`, `Found`, `tg_op`, `TG_OP`
- **THEN** the declaration fails with `reserved-local-name`, and no
  declaration is produced

#### Scenario: A row name is judged by the locals it declares
- **WHEN** a body names a `ctx.row` or `ctx.rowOrNull` read `found`
- **THEN** the declaration succeeds — a row read declares one scalar
  local per projected column (`found_id`, `found_status`), never a
  variable under the row name itself, and none of those locals is an
  owned name

#### Scenario: A keyword Postgres fully reserves is refused the same way
- **WHEN** a function declares an argument whose derived SQL name is
  `analyse`, `analyze`, `current_catalog`, `except`, `lateral` or
  `system_user`
- **THEN** the declaration fails with `reserved-local-name`, exactly as
  an argument named `select` or `order` already does

#### Scenario: A keyword reserved for function and type names is refused
- **WHEN** a function declares an argument whose derived SQL name is
  one of `authorization`, `binary`, `collation`, `concurrently`,
  `cross`, `current_schema`, `freeze`, `full`, `ilike`, `inner`, `is`,
  `isnull`, `join`, `left`, `like`, `natural`, `notnull`, `outer`,
  `overlaps`, `right`, `similar`, `tablesample` or `verbose`
- **THEN** the declaration fails with `reserved-local-name` — a body
  that assigns to or reads such a name as rendered (`raise exception
  'value %', left;`) is refused by Postgres at creation with a syntax
  error, and a body naming `current_schema` is created but resolves
  the name to the builtin in every expression position — `where
  "status" = current_schema` compares against the schema name, not the
  argument

#### Scenario: A name that merely contains an owned name is accepted
- **WHEN** a function declares an argument, or names a loop,
  `found_at`, `row_found`, `tg`, `tg_ops`, `sqlstate_code` or `state`,
  or names a row read `tg` whose projected columns derive no owned
  name (`tg` with a column `id` declares `tg_id`)
- **THEN** the declaration succeeds and the name renders unquoted as
  before — while the same row name with a column `op` is refused, for
  the local `tg_op` it would declare

### Requirement: A setof body returns the declared table's whole row
Under `returns setof <table>`, `ctx.return(...)` SHALL accept only a
query whose rows are that table's whole row: a select of that table
(`select(<table>)…`, joins and conditions allowed), or an insert, update
or delete on that table whose chain ends in a bare `.returning()`. It
SHALL refuse, at declaration time and with a named error whose `Next:`
clause names those two forms, a query whose projection is anything else
— a projected `.returning({ … })`, a select with a column projection, or
a query whose row source is another table — even when the projection
lists every column.

The rendered `return query …` carries the whole row in the table's
physical column order, so the function's result rows are exactly the
rows Postgres expects for `returns setof <table>`. Postgres matches those
rows positionally, by count and type, names ignored: a narrower
projection is accepted at `CREATE` and fails on the first call, and a
complete projection in another order with coincident types is accepted
and silently wrong. The declaration is the only place either is visible.

The accepted type narrows to match: a projected returning is not
assignable to `ctx.return` in the type it takes, and a caller reaching
the recorder with the type bypassed is refused with the same error. The
refusal runs after the returning-stage check and before anything is
recorded: a mutation with no `.returning()` still fails with
`return-expects-returning` first.

#### Scenario: A projected returning under setof is refused
- **WHEN** the body of a function returning `setof <table>` returns an
  insert, update or delete on that table whose chain ends in
  `.returning({ … })` — one column, several, every column, every column
  in another order, or an aliased column
- **THEN** the declaration fails with the named error, and no declaration
  is produced

#### Scenario: A projected select under setof is refused
- **WHEN** such a body returns a select with a column projection over
  that table, or any select whose row source is another table
- **THEN** the declaration fails with the same named error

#### Scenario: The whole-row forms are accepted and render in physical order
- **WHEN** such a body returns `select(<table>)` — with or without a
  join or a condition — or a mutation on that table ending in a bare
  `.returning()`
- **THEN** the declaration succeeds and the body renders `return query
  …;` listing the table's columns in physical order

#### Scenario: The returning-stage refusal comes first
- **WHEN** such a body returns a mutation that never called
  `.returning()`, with the type bypassed
- **THEN** it fails with `return-expects-returning`, not with the
  whole-row error
