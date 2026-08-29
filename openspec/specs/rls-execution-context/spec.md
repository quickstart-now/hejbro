# rls-execution-context Specification

## Purpose

Lets queries run under a database-enforced authorization context (role
plus session settings) so RLS policies written in the schema DSL are
exercised by the same product, safely under connection pooling.

## Requirements

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

### Requirement: Context execution requires transactions
Executing under a context on a driver without the interactive-
transaction capability SHALL fail with the explicit missing-capability
error before any statement is sent — never by falling back to a
connection-level setting, and never by executing the caller's statements
unscoped.

#### Scenario: Context on a non-transactional driver
- **WHEN** `db.as(context)` executes on a driver lacking interactive
  transactions
- **THEN** the call fails naming the missing capability and nothing
  reaches the database

#### Scenario: A preset's one-shot driver refuses a context
- **WHEN** `db.as(context)` is used on a provider preset's driver built
  for a connection path that declares interactive transactions `false`
- **THEN** the call fails with the same missing-capability error, and the
  preset supplies no alternative path that would apply the context
  another way

### Requirement: Token verification never happens in the preset, and where it does happen decides the surface
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

### Requirement: The Neon preset fixes the authentication mode at construction
Neon's session extension resolves identity from one of two settings
depending on how the database is configured: a claims object, or a raw
JWT it verifies itself. The two are mutually exclusive — when the
database verifies a token itself, the claims setting is ignored entirely.
The preset SHALL take the mode once, when its auth surface is
constructed, and SHALL expose only the builders that mode can use, so
that a single codebase cannot mix them. The mode SHALL NOT be discovered
by querying the database: that is a probe, and the surface is fixed as
data before any connection exists, exactly as a driver's capabilities
are. Every builder SHALL carry its value as a transaction-local session
setting through the generic mechanism, adding no platform-specific step
to it.

Where the mode is not statically known to the type layer, the
constructed surface SHALL expose neither mode's builders until the mode
is narrowed — failing closed at compile time — rather than exposing
both.

The claims-mode builder `asUser(claims)` SHALL accept an arbitrary claims object that requires a
`sub` claim identifying the subject — enforced both as a compile-time
type constraint and as a fail-fast runtime check for a caller that
bypasses the type — SHALL fix the role to `authenticated`, and SHALL
discard any caller-supplied `role` claim. The raw-JWT builder SHALL name
the token in its own name, accept the token as an opaque string, fix the
role to `authenticated`, and SHALL NOT decode, inspect, or validate the
token. `asAnonymous()` SHALL fix the role to `anonymous` — Neon's own
role name, which differs from Supabase's — with no subject requirement
and no other setting.

#### Scenario: A Neon user context names Neon's roles
- **WHEN** a context is built with `asUser(claims)`
- **THEN** the applied role is `authenticated` and the claims reach the
  database as a transaction-local setting, never inlined into statement
  text

#### Scenario: A missing subject fails fast
- **WHEN** `asUser(claims)` is called with a claims object lacking `sub`
- **THEN** the call fails immediately with an explicit error, rather than
  producing a context under which the platform's `auth.uid()` would
  silently return NULL

#### Scenario: The raw-JWT builder passes the token through untouched
- **WHEN** a context is built with the raw-JWT builder
- **THEN** the applied role is `authenticated`, the token reaches the
  database as a transaction-local setting exactly as given, and the
  preset performs no decoding or signature check of its own

#### Scenario: One codebase cannot mix the two modes
- **WHEN** an auth surface constructed for one mode is asked for the
  other mode's builder
- **THEN** the program fails to type-check, because that builder is not
  part of the surface that mode produces

#### Scenario: An unnarrowed mode exposes neither builder
- **WHEN** the auth surface is constructed from a mode value the type
  layer has not narrowed to one of the two modes
- **THEN** neither mode's builder is accessible until the value is
  narrowed, rather than both becoming accessible

#### Scenario: The anonymous builder uses Neon's role name
- **WHEN** a context is built with `asAnonymous()`
- **THEN** the applied role is `anonymous`, and no identity setting is
  applied

### Requirement: The preset states what it cannot detect about the database
The preset SHALL NOT read database state to discover which authentication
mode the database is configured for: that is a probe, and the mechanism
applies a context without asking the database anything first. Fixing the
mode at construction therefore removes mixing, not mismatch — the
declared mode can still be the wrong one for that database, and nothing
in the type layer or at run time can say so. The preset's documentation
SHALL state the failure this produces, **in both of its halves**: a
context applies a role and an identity setting, and a wrong mode
disables only the identity half. Policies keyed on the identity function
therefore deny, but policies keyed only on the role — `to authenticated
using (true)` and its relatives, the ordinary way to write "any signed-in
user" — still admit, and the request then runs as a generic
authenticated user with no identity ever resolved. The documentation
SHALL warn about that second case and SHALL give the reader a way to
reach the cause from the symptom. It SHALL also state that a token's
validity is checked by the database when identity is first read, not
when the context is applied.

#### Scenario: A mismatched context denies where identity is the key
- **WHEN** a context built for one authentication mode is applied to a
  database configured for the other, and a policy is keyed on the
  identity function
- **THEN** the identity function returns NULL under that context and the
  policy denies access

#### Scenario: A mismatched context still admits where the role is the key
- **WHEN** the same mismatched context is applied and a policy is keyed
  only on the role
- **THEN** the policy admits, because the role half of the context
  applied normally — the request runs with no identity, which the
  preset's documentation warns about rather than prevents

#### Scenario: An invalid token surfaces at first use
- **WHEN** a context carrying a malformed or unverifiable token is
  applied
- **THEN** applying the context succeeds and the failure surfaces when
  the database first resolves identity, which the preset documents rather
  than masks
