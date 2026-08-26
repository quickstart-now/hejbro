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
