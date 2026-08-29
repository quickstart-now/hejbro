## ADDED Requirements

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

## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: Token verification stays with the application`
- TO: `### Requirement: Token verification never happens in the preset, and where it does happen decides the surface`

### Requirement: Token verification never happens in the preset, and where it does happen decides the surface
A preset SHALL NOT verify or decode a raw token itself. Verification
SHALL happen somewhere, and which surface a preset may offer follows from
where that somewhere is.

The Supabase preset SHALL provide no surface that accepts a raw JWT
string: under Supabase's convention nothing inside the database verifies
a token, so a raw-token surface would let an unverified or self-verified
token reach the database as a forged subject. The claims object
`asUser(claims)` accepts SHALL be the caller's own already-verified
claims (for example supabase-js `getClaims`, Clerk `sessionClaims`,
Auth0 sessions, or `jose` against a custom JWKS).

The Neon preset MAY provide a raw-token surface **only for the
authentication mode whose database verifies the token's signature
against a configured key**. In that mode verification is not skipped; it
moves from the application to the database, and the same invariant holds
— an unverified token cannot become a subject. Where that key is absent,
the setting is ignored, no identity is resolved, and the token confers
nothing.

#### Scenario: No raw-token surface exists for Supabase
- **WHEN** a caller wants to run a query under a user's identity with the
  Supabase preset
- **THEN** they supply an already-verified claims object to
  `asUser(claims)`; the preset provides no function that accepts a raw
  JWT string

#### Scenario: A raw token reaches a database that verifies it
- **WHEN** a raw token is carried by the Neon preset's JWT-mode
  builder to a database with a verification key configured
- **THEN** the database checks the signature before resolving identity,
  and the preset itself has decoded nothing

#### Scenario: A raw token reaches a database that cannot verify it
- **WHEN** a raw token is carried to a database with no verification key
  configured
- **THEN** the setting is ignored, identity resolves to NULL, and the
  token grants no subject — a forged token is worth exactly as much as a
  genuine one, which is nothing

### Requirement: Presets define the context type
The concrete context surface SHALL come from the preset (or the vanilla
driver package): the Supabase preset SHALL provide `asUser(claims)` and
`asAnon()` producing contexts matching Supabase's RLS conventions
(`authenticated`/`anon` roles and a JWT claims session setting); the Neon
preset SHALL provide its builders through an auth surface constructed for
one authentication mode — `asUser(claims)` or a raw-JWT builder
depending on that mode, and `asAnonymous()` in either — producing
contexts matching Neon's conventions (`authenticated`/`anonymous` roles,
and whichever identity setting that mode reads); the vanilla surface
SHALL provide a role-based context. The generic mechanism SHALL contain
no preset-specific behavior. Where two presets name the same concept
differently, or where one offers a surface the other refuses, the
difference SHALL come from the platform's own vocabulary and
requirements, never from a preference for uniformity between presets: the
Supabase preset offers no raw-token surface because nothing inside a
Supabase database verifies a token, and the Neon preset offers one only
for the mode whose database does — as the *Token verification never
happens in the preset* requirement states, and for that reason alone.

#### Scenario: Supabase user context reaches auth helpers
- **WHEN** a select on an RLS-protected table executes under
  `asUser(claims)` against a Supabase-convention database
- **THEN** rows are filtered exactly as the declared policies dictate
  for that claims object's subject (for example `authUidCached()`
  resolves to `claims.sub`)

#### Scenario: Neon user context reaches auth helpers
- **WHEN** a select on an RLS-protected table executes under the Neon
  preset's `asUser(claims)` against a database with `pg_session_jwt`
  installed in claims mode
- **THEN** rows are filtered exactly as the declared policies dictate for
  that claims object's subject (for example `authUid()` resolves to
  `claims.sub`)

#### Scenario: The generic mechanism gains nothing per preset
- **WHEN** a second preset's context builders are added
- **THEN** the shared context mechanism applies them through the same
  role and settings path it already uses, with no branch naming a
  provider
