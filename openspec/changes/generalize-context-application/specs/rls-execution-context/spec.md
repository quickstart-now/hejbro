# rls-execution-context (delta)

## MODIFIED Requirements

### Requirement: Generic context mechanism
The query layer SHALL define a generic execution context of an optional
role plus a list of session settings. How that context becomes statements
SHALL be a driver contribution: the active driver MAY render the context
into an ordered list of compiled statements, and a driver that
contributes none SHALL receive the default rendering (a `SET LOCAL ROLE`
statement followed by one parameterized `set_config` call per setting).
The query layer SHALL retain everything else: it validates the context,
opens the wrapping transaction, and sends the rendered statements itself
— first, in the given order, before any caller-supplied statement — so
nothing persists on the connection afterwards. A contributing driver
SHALL NOT send those statements itself, and SHALL NOT open a connection
or a transaction of its own to apply a context.

The query layer SHALL NOT name any platform's setting key, statement
form, or ordering rule: a platform whose context statements must be
first, or must avoid a particular function, expresses that through its
own driver's contribution, never through a branch in the query layer.

#### Scenario: Context applies only inside the transaction
- **WHEN** a statement is executed under a context on a pooled
  connection
- **THEN** the role and settings are applied transaction-locally before
  the statement, and a subsequent statement on the same connection
  without a context observes none of them

#### Scenario: A driver's contributed statements are what gets sent
- **WHEN** a statement is executed under a context on a driver that
  contributes its own context rendering
- **THEN** exactly that driver's statements are sent, in exactly its
  order, as the first statements inside the wrapping transaction, and
  the default rendering appears nowhere

#### Scenario: A driver that contributes nothing gets today's statements
- **WHEN** a statement is executed under a context on a driver that
  contributes no rendering
- **THEN** the statements sent are the `SET LOCAL ROLE` statement and one
  parameterized `set_config` call per setting, in declaration order,
  unchanged from before this contribution point existed

#### Scenario: The contribution is a value, not an effect
- **WHEN** a contributing driver's rendering is invoked with a context
- **THEN** it returns the statements and sends nothing itself — the
  rendering can be asserted with no database and no connection

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
before any statement is sent, with an explicit error — never admitted as
a permissive default, and never silently applied as "whatever role the
connection already holds".

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
- **THEN** the call fails immediately, before any statement reaches the
  database, and the execution does not proceed under the connection's
  existing role

#### Scenario: A role-less context is admitted where the platform has none
- **WHEN** `db.as(context)` is called with a context naming no role, on a
  driver that declares its platform has no roles
- **THEN** the call succeeds, no role statement is sent at all, and the
  context's settings are applied through the driver's own rendering

### Requirement: The role and settings reach the database safely
In the default rendering, the role SHALL be applied via a `SET LOCAL
ROLE` statement with the role name quoted through the same
identifier-quoting rule every other generated identifier uses; `SET LOCAL
ROLE` accepts no bind parameter, so quoting is its only defense and SHALL
escape an embedded quote rather than passing it through raw. Every
session setting SHALL be applied via a parameterized `set_config` call
with both the setting's key and its value passed as bind parameters,
never interpolated into SQL text.

A driver that contributes its own rendering SHALL carry the same
obligation for the statements it produces: where its platform's statement
form cannot accept a bind parameter, the driver — not the query layer —
SHALL be responsible for escaping or otherwise constraining the value it
interpolates, and the safety of its rendering SHALL be verified in that
driver's own package. Contributing a rendering SHALL NOT be a way to
lower this bar.

#### Scenario: An adversarial role is never inlined unescaped
- **WHEN** a role name containing a double quote is applied
- **THEN** the rendered `SET LOCAL ROLE` statement escapes the embedded
  quote, and the raw, unescaped role name never appears as its own
  substring of the statement

#### Scenario: An adversarial setting value never reaches SQL text
- **WHEN** a context's settings include a value containing SQL syntax
- **THEN** the value reaches the driver only as a bound parameter to
  `set_config`, never inlined into the statement text

#### Scenario: A contributed rendering owns its own values
- **WHEN** a contributing driver's rendering produces a statement that
  cannot carry a bind parameter
- **THEN** that driver's own package verifies what the rendering does
  with an adversarial value, and the query layer applies the statements
  as given without inspecting or rewriting them

## ADDED Requirements

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
