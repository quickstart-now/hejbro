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
driver package): the Supabase preset SHALL provide `asUser(claims)` and
`asAnon()` producing contexts matching Supabase's RLS conventions
(`authenticated`/`anon` roles and a JWT claims session setting); the
vanilla surface SHALL provide a role-based context. The generic
mechanism SHALL contain no preset-specific behavior.

#### Scenario: Supabase user context reaches auth helpers
- **WHEN** a select on an RLS-protected table executes under
  `asUser(claims)` against a Supabase-convention database
- **THEN** rows are filtered exactly as the declared policies dictate
  for that claims object's subject (for example `authUidCached()`
  resolves to `claims.sub`)

### Requirement: Supabase context builders use a claims object surface
The Supabase preset's `asUser(claims)` SHALL accept an arbitrary claims
object that requires a `sub` claim identifying the subject — enforced
both as a compile-time type constraint (the claims parameter's type
requires `sub: string`) and as a fail-fast runtime check for a caller
that bypasses the type. `asUser(claims)` SHALL fix the role to
`authenticated` and SHALL discard any caller-supplied `role` claim,
always substituting `"authenticated"` — a caller-supplied role is never
trusted. `asAnon()` SHALL fix the role to `anon` with no `sub`
requirement and no other claim.

#### Scenario: asUser requires a subject claim
- **WHEN** `asUser(claims)` is called with a `claims` value that omits
  `sub`
- **THEN** the call fails immediately with a `claims-subject-missing`
  error, before any statement reaches the database

#### Scenario: A caller-supplied role claim is never trusted
- **WHEN** `asUser(claims)` is called with a `role` claim present in
  `claims`
- **THEN** the resulting context's settings carry `role: "authenticated"`
  regardless of what `claims.role` said

### Requirement: Supabase context maps to exactly one JSON setting
The Supabase context surface SHALL set exactly one session setting,
`request.jwt.claims`, whose value SHALL be the claims object (merged
with the fixed role) serialized as a single JSON string — never split
across multiple flat keys (e.g. no separate `request.jwt.claim.sub`
setting is ever written).

#### Scenario: One JSON setting carries every claim
- **WHEN** `asUser(claims)` or `asAnon()` builds a context
- **THEN** the context's `settings` contain exactly the key
  `request.jwt.claims` and no other key, and its value is a JSON string

### Requirement: Token verification stays with the application
The Supabase preset SHALL NOT verify or decode a raw token itself. The
claims object `asUser(claims)` accepts SHALL be the caller's own
already-verified claims (for example supabase-js `getClaims`, Clerk
`sessionClaims`, Auth0 sessions, or `jose` against a custom JWKS) — the
preset SHALL provide no surface that accepts a raw JWT string, so an
unverified or self-verified token can never reach the database as a
forged subject.

#### Scenario: No raw-token surface exists
- **WHEN** a caller wants to run a query under a user's identity
- **THEN** they supply an already-verified claims object to
  `asUser(claims)`; the preset provides no function that accepts a raw
  JWT string

### Requirement: Context execution requires transactions
Executing under a context on a driver without the interactive-
transaction capability SHALL fail with the explicit missing-capability
error before any statement is sent.

#### Scenario: Context on a non-transactional driver
- **WHEN** `db.as(context)` executes on a driver lacking interactive
  transactions
- **THEN** the call fails naming the missing capability and nothing
  reaches the database
