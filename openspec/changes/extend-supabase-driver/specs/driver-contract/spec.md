## ADDED Requirements

### Requirement: A provider whose paths are indistinguishable in the client value takes the path as a declaration
Where a provider's connection paths differ in capability but are carried
by the same client type — one client class pointed at a different
endpoint — the driver SHALL take the path as an explicit statement made
by the caller at construction. It SHALL NOT derive the path from the
client value's own configuration: not from a connection string, a host,
a port, or any other option the client carries. The declared path SHALL
fix the capability set at construction, before any connection exists,
and SHALL NOT be a single set that averages the endpoints. A driver
SHALL NOT send any statement, open any connection, or otherwise consult
the server to confirm or correct the declaration. Where no path is
declared, the driver SHALL keep the capability set it declared before
the option existed, so an existing caller's declaration is never changed
by the arrival of a second path.

#### Scenario: A declared path fixes the capability set
- **WHEN** a driver is built for a provider whose endpoints share one
  client type, with the path stated at construction
- **THEN** its capability set follows the stated path and is readable
  before any connection is made

#### Scenario: The declaration is not derived from the client's configuration
- **WHEN** the client value carries a connection string, host, or port
  that would reveal which endpoint it addresses
- **THEN** the driver reads none of them, and the stated path alone
  decides the capability set

#### Scenario: A declared path is never confirmed against the server
- **WHEN** a driver value built from a declared path executes a
  statement
- **THEN** nothing was sent to the server to confirm or correct the
  declaration, and the declaration is not revised by anything observed
  at run time

#### Scenario: An undeclared path keeps the previous declaration
- **WHEN** a driver is built without stating a path
- **THEN** it declares exactly the capability set it declared before the
  path could be stated at all

## MODIFIED Requirements

### Requirement: A driver's capability set follows its connection path
A provider whose client library offers more than one connection path
**as distinguishable client values** SHALL declare the capability set of
the path a given driver value was built for, fixed at construction from
the client it was handed — never discovered by probing a connection, and
never a single set that averages the paths. **Where the client value
distinguishes the path,** choosing the path SHALL be the caller's
existing decision (which client they constructed), not a second decision
the driver asks them to repeat.

#### Scenario: A session-path driver declares full capabilities
- **WHEN** a driver is built from the provider's session-oriented client
  (one that keeps a connection open across statements)
- **THEN** it declares both interactive transactions and session state as
  supported

#### Scenario: A one-shot-path driver declares its limits
- **WHEN** a driver is built from the provider's one-shot client (one
  that carries no session between statements)
- **THEN** it declares interactive transactions and session state as
  `false`, and both declarations are readable before any connection is
  made

#### Scenario: The path is fixed by the client, not by a runtime probe
- **WHEN** a driver value is constructed
- **THEN** its capability set is already final, and no statement, ping,
  or connection attempt was made to determine it

### Requirement: Presets ship their own driver
A provider preset package SHALL be able to ship its own driver for its
platform's connection paths, built on the same contract with no special
cases in the query layer. A preset driver SHALL be able to declare a
capability `false` and rely on the query layer's own missing-capability
error, without the preset supplying any substitute behavior for the
capability it lacks.

#### Scenario: Supabase driver plugs in unchanged
- **WHEN** a db handle is created with the Supabase preset's driver
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: Supabase driver plugs in unchanged on its pooled-transaction path
- **WHEN** a db handle is created with the Supabase preset's driver
  built for the endpoint that keeps no session between transactions
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: Neon driver plugs in unchanged on its session path
- **WHEN** a db handle is created with the Neon preset's driver built
  from a session-oriented client
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: A preset driver's rows arrive in the vanilla shapes
- **WHEN** a preset driver built on a client library with its own type
  parsers — not the vanilla driver's — reads back values whose arrival
  shape the contract fixes
- **THEN** they arrive in the same shapes the vanilla driver produces,
  because the conversion layer above is written against those shapes and
  reads no capability that would tell it otherwise

#### Scenario: A driver's own transaction member refuses when the capability is false
- **WHEN** a driver that declares interactive transactions `false` has
  its transaction member called directly, bypassing the query layer's
  guard
- **THEN** it throws the missing-capability error without sending
  anything to the database, rather than running the callback against a
  session — the driver enforces its own declaration, not only the layer
  above it

#### Scenario: A preset driver's declared-false capability fails closed
- **WHEN** an operation requiring interactive transactions is attempted
  on the Neon preset's one-shot driver
- **THEN** the call fails with the query layer's missing-capability error
  naming the capability and the operation, before anything is sent to the
  database, and the preset contributes no fallback path

### Requirement: A driver without session state guarantees its own statements
A driver that declares session state as `false` SHALL still deliver the
session settings the query layer's value conversion depends on, for the
statements it executes, by applying them as part of each execution rather
than once per connection. Declaring `false` SHALL NOT be read as
permission to let those settings go unapplied: the declaration describes
persistence between executions, not whether the settings hold for the
statement being run. Where such a driver also declares interactive
transactions `true`, the settings SHALL be applied with transaction-local
scope inside the same transaction as the statements they cover, so that
a settings statement can never land in a different transaction — and
therefore on a different backing connection — from the statement it was
meant to cover.

#### Scenario: The settings travel with the statement
- **WHEN** a driver declaring session state `false` executes a statement
- **THEN** what it sends carries those settings together with that
  statement, in that order, so the statement cannot run under a
  connection that never received them

#### Scenario: The declaration stays false
- **WHEN** such a driver's capabilities are examined
- **THEN** session state still reads `false`, because state does not
  persist from one execution to the next

#### Scenario: A driver that keeps transactions but not sessions carries its settings inside one
- **WHEN** a driver declaring interactive transactions `true` and session
  state `false` executes a single statement
- **THEN** the settings are sent after that transaction has opened and
  before the caller's statement, inside it — never before the
  transaction begins, where a transaction-local setting would be
  discarded without applying, and never in a transaction of their own,
  where the endpoint's connection reuse could separate them from the
  statement they cover

#### Scenario: A caller's own transaction carries the settings as its first statements
- **WHEN** such a driver runs a caller-supplied transaction callback
- **THEN** the settings are applied as that transaction's first
  statements, and the driver opens no second transaction around it

#### Scenario: Values arrive in the vanilla shapes on the per-execution path
- **WHEN** such a driver reads back values whose arrival shape the
  session settings determine
- **THEN** they arrive in the same shapes the vanilla driver produces,
  because the settings were applied for that execution — a value's shape
  never depends on how the settings reached the connection
