# driver-contract (delta)

## ADDED Requirements

### Requirement: A driver may contribute how a context becomes statements
The driver contract SHALL carry an optional context-rendering
contribution: a driver MAY turn an execution context into an ordered list
of compiled statements. The contribution SHALL be a pure mapping from the
context value to statements — it SHALL NOT send anything, open a
connection, hold a session, or consult the server — and the query layer
SHALL be the one that sends the returned statements, first among the
statements it sends inside the transaction it opens for that execution,
ahead of the caller's own, in the order given.

The contribution SHALL NOT be represented as a driver capability: the
capability set stays exactly the two named capabilities, and this is a
declaration about how a platform takes a context, in the same spirit as
the contributed roles a driver already declares. A driver that
contributes nothing SHALL be applied the query layer's default rendering,
whose statements SHALL be unchanged from those the layer sent before any
contribution point existed.

The default rendering SHALL be reachable by a driver package, so a driver
whose platform needs the ordinary statements plus its own can compose
them rather than restate them.

The statements the query layer sends first are first **among its own**:
a driver may already send session statements of its own inside the
transaction it opens, before the query layer sends anything (a
transaction-mode pooler pinning output formats is the shipped example,
and its pins do precede the context statements today). Where a platform
requires the context to precede every other statement in the
transaction, its driver SHALL carry those session statements in its own
rendering — after the context statements it renders and before the
caller's own — rather than in the transaction setup that runs earlier.
The query layer SHALL preserve the order the rendering returns, which is
what makes that placement sufficient.

#### Scenario: A driver that must run the context first carries its own statements in the rendering
- **WHEN** a driver whose platform requires the context to come first
  renders a context, and an execution runs under it
- **THEN** its rendering's own session statements arrive after the
  context statements and before the caller's statement, in the order the
  rendering returned them, and the driver's transaction setup sends
  nothing ahead of them

#### Scenario: The contribution is a pure mapping
- **WHEN** a contributing driver's rendering is called with a context, in
  a test with no database
- **THEN** it returns the statements it would apply, and nothing is sent,
  connected, or consulted

#### Scenario: The query layer sends what the driver returned
- **WHEN** an execution runs under a context on a contributing driver
- **THEN** the statements the driver returned are the first statements
  the query layer itself sends inside that execution's transaction,
  ahead of the caller's own, in the driver's own order, sent through the
  query layer's own execution path

#### Scenario: Contributing nothing keeps the existing statements
- **WHEN** an execution runs under a context on a driver that contributes
  no rendering — the vanilla driver and both existing presets included
- **THEN** the statements sent are exactly the ones sent before this
  contribution point existed

#### Scenario: The contribution is not a capability
- **WHEN** a driver value's declared capability set is examined
- **THEN** it still names exactly the two fixed capabilities, and the
  context-rendering contribution is not among them

#### Scenario: The default rendering is importable from the package entry
- **WHEN** a driver package imports the default rendering from
  `@hejbro/query`'s public entry point
- **THEN** the import resolves to the rendering the query layer itself
  applies, and no deep or internal module path is required

### Requirement: A driver declares whether its platform has roles
A driver SHALL be able to declare that its platform has no roles a
context could name. The declaration SHALL be data on the driver value,
fixed before any connection exists, never discovered by querying the
server, and its absence SHALL mean "this platform has roles" — so no
existing driver changes meaning by staying silent.

The declaration SHALL govern which contexts the query layer admits: on a
driver that declares its platform role-less, a context naming no role is
admitted; on any other driver, it is refused. A driver SHALL NOT be able
to use this declaration to skip validation of a role that *is* named.

#### Scenario: The declaration is readable before any connection
- **WHEN** a driver value declaring a role-less platform is examined
- **THEN** the declaration is present as data, and no connection,
  statement, or probe was made to produce it

#### Scenario: Silence means the platform has roles
- **WHEN** a driver that makes no such declaration is handed a context
  naming no role
- **THEN** the execution is refused, exactly as if the driver had declared
  its platform has roles

#### Scenario: A named role is still validated on a role-less platform
- **WHEN** a context naming a role is used on a driver declaring a
  role-less platform
- **THEN** the role is validated against the same four-source whitelist,
  and the declaration grants no exemption from it

### Requirement: A driver can declare a context mandatory
A driver SHALL be able to declare that no statement may run against it
without an execution context, so that the query layer refuses an
uncontexted execution before anything reaches the database. The
declaration SHALL be data on the driver value, fixed before any
connection exists, and its absence SHALL leave existing behavior exactly
as it is.

The declaration SHALL NOT be represented as a capability, SHALL NOT be
inferred from the platform or from an observed error, and SHALL NOT be
satisfied by anything the driver does on its own — the refusal belongs to
the query layer, which is the only layer that can refuse before a
statement exists.

#### Scenario: The declaration is inspectable data
- **WHEN** a driver value declaring a mandatory context is examined
  before any connection is made
- **THEN** the declaration is readable, and nothing was sent to the
  server to establish it

#### Scenario: A driver cannot satisfy it by itself
- **WHEN** such a driver receives a statement through its own execute
  member, bypassing the query layer
- **THEN** the driver's own behavior is unchanged by the declaration —
  the declaration governs what the query layer refuses to send, not what
  the driver does with what it is given

### Requirement: Contributing a context rendering does not widen who may run one
An execution under a context SHALL continue to require the
interactive-transaction capability, asserted before any resolver is
consulted and before any statement is sent. A driver that contributes a
context rendering but does not declare interactive transactions SHALL
still be refused a context, with the same missing-capability error, and
its contribution SHALL never be applied.

#### Scenario: A contributing driver without transactions is still refused
- **WHEN** an execution under a context is attempted on a driver that
  contributes a context rendering and declares interactive transactions
  `false`
- **THEN** the execution fails with the missing-capability error naming
  the capability and the operation, the contribution is never invoked,
  and nothing reaches the database

#### Scenario: The capability is asserted before the resolver
- **WHEN** an execution is attempted on a provider handle whose driver
  lacks interactive transactions and contributes a context rendering
- **THEN** the failure names the missing capability, and neither the
  resolver nor the contribution was called

#### Scenario: A preset's one-shot path is unchanged by the contribution point
- **WHEN** `db.as(context)` is used on the Neon preset's one-shot (HTTP)
  driver, after a context-rendering contribution point exists on the
  contract
- **THEN** it fails with exactly the missing-capability error it failed
  with before that point existed, nothing reaches the database, and no
  contributed or default rendering is applied — the set of drivers that
  may run a context is the same set as before this change
