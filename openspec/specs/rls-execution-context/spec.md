# rls-execution-context Specification

## Purpose

Lets queries run under a database-enforced authorization context (role
plus session settings) so RLS policies written in the schema DSL are
exercised by the same product, safely under connection pooling.

## Requirements

### Requirement: Generic context mechanism
The query layer SHALL define a generic execution context of an optional
role plus a list of session settings. How that context becomes statements
SHALL be a driver contribution: the active driver MAY render the context
into an ordered list of compiled statements, and a driver that
contributes none SHALL receive the default rendering (a `SET LOCAL ROLE`
statement followed by one parameterized `set_config` call per setting).
The query layer SHALL retain everything else: it validates the context,
opens the wrapping transaction, and sends the rendered statements itself
— first among the statements it sends, in the given order, ahead of the
caller's own. A contributing driver SHALL NOT send those statements
itself, and SHALL NOT open a connection or a transaction of its own to
apply a context.

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
  order, as the first statements the query layer itself sends inside the
  wrapping transaction, ahead of the caller's own — the default
  rendering appears nowhere

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
before any statement is sent, with an explicit, coded
`context-role-missing` error — never admitted as a permissive default,
and never silently applied as "whatever role the connection already
holds".

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

A contributed rendering SHALL carry the transaction-local obligation as
well: its statements SHALL take effect only for the transaction the
query layer opened for that execution — the scope the default rendering
gets from `SET LOCAL` and a transaction-scoped `set_config` — so that
nothing a context applied outlives that transaction on a pooled
connection. Where its platform's statement forms scope differently,
constraining them is the driver's own responsibility, and that its
rendering does so SHALL be verified in that driver's own package.

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

#### Scenario: A contributed rendering leaves nothing behind
- **WHEN** an execution runs under a context on a contributing driver,
  and a later statement runs on the same pooled connection without a
  context
- **THEN** the later statement observes none of the contributed
  context's role or settings, because the contributed statements took
  effect only for the transaction that carried them — verified in the
  contributing driver's own package

### Requirement: Context-scoped handle
`db.as(context)` SHALL return a handle whose executions all run under
that context, without mutating the original handle.

#### Scenario: Scoped and unscoped handles coexist
- **WHEN** `db.as(context)` is created from a provider-less handle and
  both handles execute statements
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
in the type layer or at run time can say so.

The preset's user documentation — the hejbro skill's Neon reference
(`skills/hejbro/references/neon-preset.md`), the surface AGENTS.md names
as the user contract — SHALL therefore state the failure this produces,
**in both of its halves**: a context applies a role and an identity
setting, and a wrong mode disables only the identity half. Policies
keyed on the identity function therefore deny, but policies keyed only
on the role — `to authenticated using (true)` and its relatives, the
ordinary way to write "any signed-in user" — still admit, and the
request then runs as a generic authenticated user with no identity ever
resolved. The documentation SHALL warn about that second case, SHALL
give the reader a way to reach the cause from the symptom, and SHALL
state that a token's validity is checked by the database when identity
is first read, not when the context is applied. This documentation
obligation is verified by a repository test asserting the three stated
facts are present — the contract is the facts, not the prose.

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
  the database first resolves identity, which the documentation states rather
  than masks

#### Scenario: The documentation obligation is machine-checked
- **WHEN** the repository's test suite runs
- **THEN** a test asserts that the Neon reference documentation states
  the deny half, the still-admits half, and the token-validity timing,
  and fails when any of the three is absent

### Requirement: A db handle can register an execution-context provider
A db handle SHALL accept, at construction, an execution-context
provider: a resolver consulted once per execution that yields the
context that execution runs under. When a provider is registered, every
execution surface the handle exposes — statement execution, every
thenable chain member, every declared-function call, and the transaction
API — SHALL run under the resolved context, applied by the same generic
mechanism `db.as(context)` uses, with no second application path. A
handle constructed without a provider SHALL behave exactly as it does
today: no context applied, no wrapping transaction opened.

The provider SHALL be generic. The query layer SHALL NOT name any
platform's role or setting: the resolved context is a value the caller
supplies, so a preset contributes its existing context builders
unchanged and no new mechanism.

#### Scenario: Every surface on a provider handle runs under the resolved context
- **WHEN** a statement execution, a chain member, a declared-function
  call, and a transaction callback are each run on a handle with a
  registered provider
- **THEN** each one runs under that context, its role and settings
  applied first, and none of the four reaches the database without them

#### Scenario: Registering a provider wraps executions that were not wrapped before
- **WHEN** a statement is executed on a handle with a registered
  provider, where the same statement on a handle without one is sent
  directly to the driver
- **THEN** the execution now opens a transaction and runs inside it,
  with the context's role and settings applied first and the caller's
  statement after them, on that one transaction — a behavior change the
  caller can observe — while the statement's own SQL and parameters are
  unchanged by it

#### Scenario: A handle without a provider is unchanged
- **WHEN** a statement is executed on a handle constructed with no
  provider
- **THEN** no context statement and no transaction are issued, exactly
  as before the provider existed

#### Scenario: A preset supplies context values, not mechanism
- **WHEN** a provider is registered whose resolver returns the Supabase
  preset's `asUser(claims)` for a request carrying verified claims and
  its `asAnon()` otherwise
- **THEN** both contexts apply through the generic mechanism, and the
  preset contributes no code beyond those existing builders

### Requirement: An explicit context overrides the registered provider
`db.as(context)` SHALL run under exactly the context named at that call
site and SHALL NOT consult a registered provider — the resolver SHALL
NOT be called at all for executions on the scoped handle. The scoped
handle's surface SHALL be unchanged by the presence of a provider.

#### Scenario: An explicit as() never consults the provider
- **WHEN** a statement is executed on `db.as(context)` from a handle
  that also has a registered provider
- **THEN** the statement runs under the explicitly named context and the
  resolver is never called

### Requirement: The provider is consulted once per execution and never cached
The resolver SHALL be called exactly once per execution, and its result
SHALL NOT be cached or reused across executions — two executions SHALL
call it twice, so a request whose identity changed is never served a
previous execution's context. A `transaction(callback)` SHALL count as
one execution: the resolver is called once for the transaction, not once
per statement inside it, because the context applies to the transaction.

#### Scenario: Two executions resolve twice
- **WHEN** two statements are executed in sequence on a provider handle
- **THEN** the resolver is called twice, and each statement runs under
  the context that call returned

#### Scenario: One transaction resolves once
- **WHEN** a transaction callback issues several statements on a
  provider handle
- **THEN** the resolver is called exactly once and the context is
  applied once, at the start of that transaction

### Requirement: A provider-supplied role is validated through the same whitelist
A context reaching the database through the provider SHALL be validated
exactly as one named at a call site: its role SHALL be checked against
the same four-source declared-role union, fail-closed, with no escape
hatch, raising the same error the explicit path raises. The check SHALL
happen before any statement reaches the database, including before the
wrapping transaction's own `begin`.

#### Scenario: An undeclared resolved role is rejected before begin
- **WHEN** the resolver returns a context whose role is in none of the
  four sources
- **THEN** the execution fails with the same undeclared-role error the
  explicit path raises, and the driver receives nothing at all — no
  transaction is even opened

### Requirement: A provider that yields no context fails closed
A registered provider's resolver SHALL yield a context; the type SHALL
NOT admit a missing one. A caller who bypasses the type and yields no
context SHALL receive a failure coded `context-provider-empty` before
any statement is sent — the execution SHALL NOT proceed under whatever
role the connection already holds. There is no unscoped path out of the
handle's execution surfaces once a provider is registered.

That subject is exact, not shorthand. A handle also exposes members that
are not execution surfaces — its `driver`, and the schema assertion that
takes one — and statements issued through those SHALL continue to reach
the database without a context, never consulting the resolver. For the
assertion that is the correct behavior, though not because a context
would hide catalog rows — the reads it performs are role-independent by
construction. The reason is that the assertion runs where there is no
request and therefore no identity to attribute: routing it through a
provider would force the resolver to invent one or throw, and a resolved
role outside the declared whitelist would fail the assertion for a
reason that has nothing to do with the schema.

A resolver that throws SHALL propagate its error unchanged. A failure to
determine identity is not the same claim as an absence of identity, and
an execution SHALL NOT proceed on either.

#### Scenario: A resolver yielding nothing sends nothing
- **WHEN** a resolver that bypasses the type yields no context
- **THEN** the execution fails with the code `context-provider-empty`,
  no transaction is opened, and no statement reaches the database — the
  statement is never sent unscoped

#### Scenario: A non-execution member of the handle stays uncontexted
- **WHEN** a statement is issued through a provider handle's own
  `driver` member — the path the schema assertion takes to read the
  catalog
- **THEN** it reaches the database with no context applied and without
  the resolver being consulted, because registering a provider wraps the
  handle's execution surfaces and not the driver it was built from

#### Scenario: A throwing resolver sends nothing
- **WHEN** the resolver throws
- **THEN** that exact error propagates to the caller, no transaction is
  opened, and no statement reaches the database

### Requirement: A provider handle requires the interactive-transaction capability
Executing on a handle with a registered provider, against a driver
without the interactive-transaction capability, SHALL fail with the same
missing-capability error `db.as(context)` raises, on the first
execution. The capability SHALL be asserted before the resolver is
called, so the failure is a property of the driver alone and does not
depend on whether the caller's auth layer answered.

#### Scenario: A missing capability fails before the resolver runs
- **WHEN** a statement is executed on a provider handle whose driver
  lacks interactive transactions
- **THEN** the execution fails naming the missing capability, the
  resolver is never called, and nothing reaches the database

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

### Requirement: The Nile preset renders a tenant context
The Nile preset SHALL provide a context builder that names a tenant, and
optionally a user, and SHALL produce a context that names no role. Its
driver SHALL render that context into statements itself, through the
driver-owned rendering contribution, and the statements SHALL be
`SET LOCAL`-form settings: the tenant setting first, and the user setting
after it when a user was named — the order the platform requires
("you must set a tenant context before setting the user context").

The rendering SHALL NOT use `set_config` for either setting. On this
platform `set_config` cannot set the tenant setting at all, and for the
user setting it is accepted while skipping the platform's own
tenant-membership check that the `SET LOCAL` form enforces; a rendering
that used it would be trading a refusal for a silent bypass.

The tenant setting SHALL be the first statement the rendering returns,
and the preset's driver SHALL NOT send any statement of its own ahead of
it — anything it needs inside the transaction rides in the same
rendering, after the context statements. On a **supported base driver**
(one that applies its session settings at connection checkout, see
`driver-contract`), that makes the tenant setting the first statement
inside the transaction as well. On a base that sends its own statements
inside the transaction it opens — the shape this preset does not support
— the tenant setting is still the first statement the query layer sends,
and the platform refuses it (measured on its test container; its
published limitations table does not state it); that is the failure the
unsupported shape produces, not an exception to this requirement.

#### Scenario: A tenant context renders the tenant setting first
- **WHEN** an execution runs under a context built for a tenant
- **THEN** the tenant setting is the first statement the query layer
  sends, ahead of the caller's own and of any other statement the preset
  contributes

#### Scenario: On a supported base, the tenant setting is first inside the transaction
- **WHEN** an execution runs under a tenant context on a decorated base
  driver that applies its session settings at connection checkout
- **THEN** the first statement recorded inside the transaction is the
  `SET LOCAL` tenant setting, with no base-driver statement ahead of it

#### Scenario: A user context renders the tenant setting before the user setting
- **WHEN** an execution runs under a context built for a tenant and a user
- **THEN** the tenant setting is sent first and the user setting
  immediately after it, in that order

#### Scenario: The rendering never reaches for set_config
- **WHEN** the preset's rendering is invoked with any context it accepts
- **THEN** none of the statements it returns is a `set_config` call, for
  either setting

#### Scenario: A context that names no role is what the builder produces
- **WHEN** the preset's context builder is called
- **THEN** the context it returns names no role, and the settings it
  carries identify the tenant (and the user, when one was named)

### Requirement: The Nile preset declares a role-less, context-mandatory platform
The preset's driver SHALL declare that its platform has no roles, and
SHALL declare a context mandatory. The first declaration is what admits a
role-less context; it SHALL NOT be read as an exemption for a context
that does name a role, which stays subject to the same declared-role
whitelist. The second declaration is what makes an uncontexted execution
fail closed at hejbro's own layer, because on this platform a missing
context widens visibility to every tenant rather than narrowing it.

Declaring a context mandatory does not block the schema assertion a
handle exposes: `assertSchema(handle)` reads through the handle's own
`driver` member, which is not an execution surface and which the corpus
already exempts. The preset states this consequence so that "the
platform requires a context" is not read as "the schema assertion stops
working".

The preset's rendering SHALL refuse a context it cannot apply, before
producing any statement: one that **names a role** — the platform has
none, its role statement is silently ignored, and that statement
additionally blocks the tenant setting behind it — or one carrying a
**setting outside the platform's own tenant and user keys**. The refusal
SHALL be an explicit coded error, `nile-context-unsupported`, whose
`field` names which part was unsupported, and SHALL NOT carry the value.
Dropping either silently would run the
caller's statements under whatever the connection already holds, which
is exactly what the declared-role requirement forbids.

#### Scenario: A role-less context is admitted on this driver
- **WHEN** an execution runs under the preset's own context, which names
  no role
- **THEN** it proceeds, and no role statement is sent

#### Scenario: A named role is still validated on this driver
- **WHEN** a context naming a role outside the declared-role union is used
  on this driver
- **THEN** it is refused before any statement is sent, exactly as it would
  be on a driver that made no role-less declaration; a role that *passes*
  the whitelist is then refused by the rendering itself, because the
  platform has no role to apply it to

#### Scenario: An uncontexted execution is refused
- **WHEN** a statement is executed on a handle built on this driver with
  no context and no registered provider
- **THEN** it fails with the query layer's `context-required` error before
  anything reaches the database

#### Scenario: The schema assertion still reaches the database
- **WHEN** `assertSchema(handle)` reads the catalog through a handle built
  on this driver
- **THEN** the read is issued and returns, because it goes through the
  handle's `driver` member rather than an execution surface, and the
  mandatory-context refusal therefore does not apply to it

#### Scenario: A context naming a role is refused, not dropped
- **WHEN** a context that names a role — including one the declared-role
  whitelist admits — is used on this driver
- **THEN** the rendering fails with an explicit coded error,
  `nile-context-unsupported`, before any statement is produced; the
  wrapping transaction the query layer had opened carries none, and the
  role is never silently ignored

#### Scenario: A setting the platform cannot take is refused, not dropped
- **WHEN** a context carries a setting key outside the platform's own
  tenant and user settings
- **THEN** the rendering fails with the same explicit coded error,
  `nile-context-unsupported`, naming the key it cannot apply, before any
  statement is produced; the wrapping transaction carries none

### Requirement: The Nile rendering constrains the values it interpolates
`SET LOCAL` carries no bind parameter, so the tenant and user values are
interpolated into statement text, and the driver — not the query layer —
owns their safety. Both values are UUIDs on this platform. The rendering
SHALL therefore refuse a value that is not a canonical UUID **before any
statement is produced** — the wrapping transaction the query layer opens
is already open when the rendering runs, and it carries none — with an
explicit coded error, and SHALL still apply the ordinary literal-quoting
rule to the value it does interpolate. The safety of this rendering SHALL
be verified in the preset's own package.

#### Scenario: A value that is not a UUID never becomes a statement
- **WHEN** a context is built with a tenant value that is not a canonical
  UUID
- **THEN** the failure is an explicit coded error, `nile-context-value-invalid`,
  raised before any statement is produced, and no statement reaches the
  driver — the query layer has already opened the wrapping transaction
  when the rendering runs, and that transaction carries none

#### Scenario: An adversarial value never appears raw in the statement
- **WHEN** a value carrying SQL syntax is passed as a tenant value
- **THEN** it is refused by the UUID check, and in no case does the raw
  value appear as its own substring of a rendered statement

#### Scenario: A valid tenant value is quoted, not concatenated
- **WHEN** a context is built with a canonical UUID
- **THEN** the rendered statement carries that value through the literal
  quoting rule rather than by raw concatenation

### Requirement: The Nile rendering is transaction-local
The statements the preset renders SHALL take effect only for the
transaction the query layer opened for that execution — the `SET LOCAL`
form is what gives them that scope — so that no context outlives its
transaction on a pooled connection. This SHALL be verified in the
preset's own package on both sides: the statement form, and the server's
own behavior.

#### Scenario: The rendered statements are transaction-scoped by form
- **WHEN** the rendering is invoked
- **THEN** every statement it returns uses the `SET LOCAL` form rather
  than a session-scoped `SET`

#### Scenario: A later transaction on the same connection sees no previous tenant
- **WHEN** an execution runs under a tenant context and a later
  transaction runs on the same connection without one
- **THEN** the later transaction does not observe the previous tenant's
  context, confirmed against a live database rather than inferred from
  the statement text
