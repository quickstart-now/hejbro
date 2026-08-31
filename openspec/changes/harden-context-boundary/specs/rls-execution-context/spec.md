# rls-execution-context (delta)

## MODIFIED Requirements

### Requirement: The role is validated against a declared whitelist
A context's role, where the context names one, SHALL be validated,
before any statement is sent, against the union of every role the schema
declares reachable: a `grant`'s role, an RLS policy's role (walked from
each declared table's own policies), a role the caller explicitly opted
into on the db handle itself, and a role the active driver contributes
(for platform-specific roles a preset's own connection convention
supplies, e.g. Supabase's `anon`/`authenticated`/`service_role`). A role
outside this union SHALL be rejected immediately, fail-closed, with no
escape hatch — including `"public"`, which SHALL receive no special-casing
in this check (a `GRANT`/`REVOKE`-clause keyword exception belongs to
rendering grants, never to role-identity validation).

Omitting the role SHALL NOT be a way around this check. A context that
names no role SHALL be admitted only where the active driver declares
that its platform has no roles; on any other driver it SHALL be rejected
before any statement is sent, with an explicit, coded
`context-role-missing` error — never admitted as a permissive default,
and never silently applied as "whatever role the connection already
holds".

A context this check admits can still be refused downstream. Where the
active driver also declares a context mandatory and the rendering in
effect produces no statement for that context, the mandatory-context
requirement refuses the execution: admission by this check is not
admission by every check.

#### Scenario: An undeclared role is rejected before any send
- **WHEN** `db.as(context)` is called with a role absent from every one
  of the four sources
- **THEN** the call fails immediately, before any statement reaches the
  database, listing the roles that *are* declared

#### Scenario: A role from any of the four sources is accepted
- **WHEN** `db.as(context)` is called with a role present in a `grant`,
  an RLS policy, the db handle's own opt-in list, or the driver's
  contributed roles
- **THEN** the call succeeds and the role is applied

#### Scenario: A role-less context is not a whitelist bypass
- **WHEN** `db.as(context)` is called with a context naming no role, on a
  driver that has not declared its platform role-less
- **THEN** the call fails immediately with the code
  `context-role-missing`, before any statement reaches the database, and
  the execution does not proceed under the connection's existing role

#### Scenario: A role-less context is admitted where the platform has none
- **WHEN** `db.as(context)` is called with a context naming no role, on a
  driver that declares its platform has no roles
- **THEN** the call succeeds, no role statement is sent at all, and the
  context's settings are applied through the rendering in effect for
  that driver — its own contribution, or the default rendering, which
  accepts a role-less context

### Requirement: A driver can require that nothing runs without a context
A driver SHALL be able to declare that no statement may run against it
without an execution context. Where a driver declares this, every
execution surface of a handle built on it — statement execution, every
thenable chain member, every declared-function call, and the transaction
API — SHALL refuse to run uncontexted, with an explicit coded error,
before anything reaches the database. The refusal SHALL be a consequence
of the driver's own declaration read as data; the query layer SHALL NOT
infer it from the platform, the connection, or an observed error.

An execution satisfies the requirement when it runs under an explicitly
named context or under a registered provider's resolved context. The
handle's non-execution members — its `driver`, and the schema assertion
that takes one — SHALL be unaffected, exactly as they are unaffected by a
registered provider.

That satisfaction SHALL NOT be vacuous. A context satisfies the
declaration only where the rendering in effect for that driver — its own
contribution, or the default rendering — produces at least one statement
for it. Where the rendering produces none, the context applied nothing,
and the execution SHALL be refused with an explicit coded error,
`context-rendering-empty`, after the rendering has run and before any
caller-supplied statement is sent; the wrapping transaction the query
layer had already opened carries none. The query layer SHALL reach that
conclusion from the number of statements the rendering returned, never by
inspecting or rewriting them.

The refusal belongs to the declaration and to nothing else. On a driver
that makes no mandatory-context declaration, a context whose rendering
produces no statement SHALL still be applied as given — that is, nothing
is sent — because an execution on that driver was already permitted to
run with no context at all, so refusing it would withdraw a permitted
execution without narrowing anything.

Every refusal this requirement raises SHALL name the surface the caller
invoked — the statement execution, the chain member, the declared-
function call, or the transaction API — spelled as the caller spells it,
the transaction API excepted, on the explicitly scoped path and the
provider path alike. That covers both refusals this requirement raises:
the one for an execution that carries no context, and the one for a
context whose rendering produced nothing. It SHALL NOT name a
construction option, and one name SHALL NOT stand in for several
surfaces, so that a caller can map the error to the call site that
produced it. The transaction API is the one exception, and it is
deliberate: its refusal keeps the token `transaction`, the spelling the
driver contract already shares across packages, because a driver outside
the query layer raises the same failure with that token and the contract
requires the two to match. Refusing alike means refusing with the same
code, from the same fail-closed timing — the identity `diagnostics`
makes machine-readable, message prose being free to move; the operation
a refusal names is the caller's own surface and therefore differs
between them.

This declaration exists because a platform can be fail-open without a
context: where a missing context widens visibility instead of narrowing
it, an unapplied context is a data-exposure outcome, not a no-op, and the
query layer's own refusal is the only layer that can fail closed on the
caller's behalf.

#### Scenario: An uncontexted execution is refused
- **WHEN** a statement is executed on a handle with no registered
  provider, built on a driver that declares a context mandatory
- **THEN** the execution fails with the explicit `context-required` error
  before anything reaches the database

#### Scenario: Every execution surface refuses alike
- **WHEN** a chain member, a declared-function call, and a transaction
  callback are each run uncontexted on such a handle
- **THEN** each fails with the same error, and none of them reaches the
  database

#### Scenario: A context satisfies the requirement
- **WHEN** the same handle runs a statement under `db.as(context)`, or a
  handle with a registered provider runs one on the same driver
- **THEN** the execution proceeds normally under that context

#### Scenario: Non-execution members are unaffected
- **WHEN** a statement is issued through such a handle's own `driver`
  member — the path the schema assertion takes to read the catalog
- **THEN** it reaches the database without a context, exactly as it does
  on a handle with a registered provider

#### Scenario: A driver that does not declare it is unchanged
- **WHEN** a statement is executed uncontexted on a driver that makes no
  such declaration
- **THEN** it runs exactly as it does today, with no context statement
  and no wrapping transaction

#### Scenario: A context whose rendering produces nothing is refused
- **WHEN** an execution runs under a context on a driver that declares a
  context mandatory, and the rendering in effect for that driver returns
  no statement for that context
- **THEN** the execution fails with the coded error
  `context-rendering-empty`, no caller-supplied statement is sent, and
  the transaction the query layer had opened carries none

#### Scenario: A context carrying nothing does not satisfy the declaration
- **WHEN** an execution names a context that carries neither a role nor
  a setting, on a driver that declares both a mandatory context and a
  role-less platform
- **THEN** it is refused with that same coded error, rather than
  proceeding with no context statement at all

#### Scenario: A driver that requires no context keeps applying nothing
- **WHEN** an execution runs under a context whose rendering produces no
  statement, on a driver that makes no mandatory-context declaration
- **THEN** it proceeds exactly as it does today, no context statement is
  sent, and no refusal is raised

#### Scenario: A refusal names the surface the caller invoked
- **WHEN** a statement execution, a `select` chain, an `insert` chain, a
  declared-function call, and a transaction callback are each refused
  uncontexted on such a handle
- **THEN** each error names the surface its own caller invoked, the two
  chain members do not share one name, and none of them names a
  construction option or a single name standing in for several surfaces
