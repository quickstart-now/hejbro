# Delta: rls-execution-context

## Purpose

Lets queries run under a database-enforced authorization context (role
plus session settings) so RLS policies written in the schema DSL are
exercised by the same product, safely under connection pooling.

## ADDED Requirements

### Requirement: Generic context mechanism
The query layer SHALL define a generic execution context of a role plus
a list of `set_config` settings. Executing under a context SHALL wrap
the statements in a transaction that applies the role and settings with
transaction-local scope (`SET LOCAL` semantics) before they run, so
nothing persists on the connection afterwards.

#### Scenario: Context applies only inside the transaction
- **WHEN** a statement is executed under a context on a pooled
  connection
- **THEN** the role and settings are applied transaction-locally before
  the statement, and a subsequent statement on the same connection
  without a context observes none of them

### Requirement: The role is validated against a declared whitelist
A context's role SHALL be validated, before any statement is sent,
against the union of every role the schema declares reachable: a
`grant`'s role, an RLS policy's role (walked from each declared table's
own policies), a role the caller explicitly opted into on the db handle
itself, and a role the active driver contributes (for platform-specific
roles a preset's own connection convention supplies, e.g. Supabase's
`anon`/`authenticated`/`service_role`). A role outside this union SHALL
be rejected immediately, fail-closed, with no escape hatch — including
`"public"`, which SHALL receive no special-casing in this check (a
`GRANT`/`REVOKE`-clause keyword exception belongs to rendering grants,
never to role-identity validation).

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

### Requirement: The role and settings reach the database safely
The role SHALL be applied via a `SET LOCAL ROLE` statement with the role
name quoted through the same identifier-quoting rule every other
generated identifier uses; `SET LOCAL ROLE` accepts no bind parameter,
so quoting is its only defense and SHALL escape an embedded quote rather
than passing it through raw. Every session setting SHALL be applied via
a parameterized `set_config` call with both the setting's key and its
value passed as bind parameters, never interpolated into SQL text.

#### Scenario: An adversarial role is never inlined unescaped
- **WHEN** a role name containing a double quote is applied
- **THEN** the rendered `SET LOCAL ROLE` statement escapes the embedded
  quote, and the raw, unescaped role name never appears as its own
  substring of the statement

#### Scenario: An adversarial setting value never reaches SQL text
- **WHEN** a context's settings include a value containing SQL syntax
- **THEN** the value reaches the driver only as a bound parameter to
  `set_config`, never inlined into the statement text

### Requirement: Context-scoped handle
`db.as(context)` SHALL return a handle whose executions all run under
that context, without mutating the original handle.

#### Scenario: Scoped and unscoped handles coexist
- **WHEN** `db.as(context)` is created and both handles execute
  statements
- **THEN** only the scoped handle's statements run under the context

### Requirement: Presets define the context type
The concrete context surface SHALL come from the preset (or the vanilla
driver package): the Supabase preset SHALL provide `asUser(jwt)` and
`asAnon` producing contexts matching Supabase's RLS conventions
(`authenticated`/`anon` roles and JWT claim settings); the vanilla
surface SHALL provide a role-based context. The generic mechanism SHALL
contain no preset-specific behavior.

#### Scenario: Supabase user context reaches auth helpers
- **WHEN** a select on an RLS-protected table executes under
  `asUser(jwt)` against a Supabase-convention database
- **THEN** rows are filtered exactly as the declared policies dictate
  for that JWT's claims (for example `authUid()` resolves to the JWT
  subject)

### Requirement: Context execution requires transactions
Executing under a context on a driver without the interactive-
transaction capability SHALL fail with the explicit missing-capability
error before any statement is sent.

#### Scenario: Context on a non-transactional driver
- **WHEN** `db.as(context)` executes on a driver lacking interactive
  transactions
- **THEN** the call fails naming the missing capability and nothing
  reaches the database
