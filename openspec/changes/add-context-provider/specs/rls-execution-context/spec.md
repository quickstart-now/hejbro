# rls-execution-context (delta)

## ADDED Requirements

### Requirement: A db handle can register an execution-context provider
A db handle SHALL accept, at construction, an execution-context
provider: a resolver consulted once per execution that yields the
context that execution runs under, and optionally a fallback context
applied when the resolver yields none. When a provider is registered, every
execution surface the handle exposes — statement execution, every
thenable chain member, every declared-function call, and the transaction
API — SHALL run under the resolved context, applied by the same generic
mechanism `db.as(context)` uses, with no second application path. A
handle constructed without a provider SHALL behave exactly as it does
today: no context applied, no wrapping transaction opened.

The provider SHALL be generic. The query layer SHALL NOT name any
platform's role or setting: both the resolved context and the fallback
context are values the caller supplies, so a preset contributes its
existing context builders unchanged and no new mechanism.

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
- **THEN** the execution now runs inside a transaction — `begin`, the
  context's role and settings, the statement, `commit` — which is a
  behavior change the caller can observe on the connection, and the
  statement's own SQL and parameters are unchanged by it

#### Scenario: A handle without a provider is unchanged
- **WHEN** a statement is executed on a handle constructed with no
  provider
- **THEN** no context statement and no transaction are issued, exactly
  as before the provider existed

#### Scenario: A preset supplies context values, not mechanism
- **WHEN** a provider is registered whose resolver returns the Supabase
  preset's `asUser(claims)` and whose fallback is its `asAnon()`
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
  explicit path raises, and the driver receives nothing at all — not
  even `begin`

### Requirement: A registered fallback is validated when the handle is constructed
A fallback context is a value known at construction, so its role SHALL
be validated then — synchronously, through the same declared-role
whitelist and the same fail-closed check `db.as(context)` applies, and
before the handle is returned. An undeclared fallback role SHALL fail at
construction rather than surviving until the first request that happens
to resolve to no context, which in a system that mostly serves
identified traffic can be long after deploy.

#### Scenario: An undeclared fallback role fails at construction
- **WHEN** a handle is constructed with a provider whose fallback
  context names a role in none of the four sources
- **THEN** construction fails immediately with the same undeclared-role
  error the explicit path raises, before any execution

### Requirement: An execution never proceeds without a context
Once a provider is registered, no execution on that handle SHALL run
without a context applied — there is no unscoped path out of such a
handle.

When the resolver yields no context and a fallback is registered, the
fallback SHALL be applied. When the resolver yields no context and no
fallback is registered, the execution SHALL fail with an explicit, coded
error before any statement is sent; it SHALL NOT proceed under whatever
role the connection already holds. Registering no fallback is therefore
how a caller says "no identity, no query", and it costs them no value
they have to invent.

A resolver that throws SHALL propagate its error unchanged and SHALL NOT
fall back. A failure to determine identity is not the same claim as an
absence of identity, and treating the first as the second would grant
the fallback's access on an error path.

#### Scenario: An absent resolution applies the registered fallback
- **WHEN** the resolver yields no context on a handle whose provider
  registered a fallback
- **THEN** the execution runs under that fallback context, and never
  under an unset role

#### Scenario: An absent resolution with no fallback sends nothing
- **WHEN** the resolver yields no context on a handle whose provider
  registered no fallback
- **THEN** the execution fails with an explicit coded error, and no
  statement reaches the database — the statement is never sent unscoped

#### Scenario: A throwing resolver sends nothing
- **WHEN** the resolver throws
- **THEN** that exact error propagates to the caller, no fallback is
  applied even when one is registered, and no statement reaches the
  database

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
