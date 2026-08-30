# rls-execution-context (delta)

## ADDED Requirements

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
context SHALL receive an explicit, coded failure before any statement is
sent — the execution SHALL NOT proceed under whatever role the
connection already holds. There is no unscoped path out of a handle that
has a provider registered.

A resolver that throws SHALL propagate its error unchanged. A failure to
determine identity is not the same claim as an absence of identity, and
an execution SHALL NOT proceed on either.

#### Scenario: A resolver yielding nothing sends nothing
- **WHEN** a resolver that bypasses the type yields no context
- **THEN** the execution fails with an explicit coded error, no
  transaction is opened, and no statement reaches the database — the
  statement is never sent unscoped

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
