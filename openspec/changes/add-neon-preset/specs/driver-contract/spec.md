## ADDED Requirements

### Requirement: A driver's capability set follows its connection path
A provider whose client library offers more than one connection path
SHALL declare the capability set of the path a given driver value was
built for, fixed at construction from the client it was handed — never
discovered by probing a connection, and never a single set that averages
the paths. Choosing the path SHALL be the caller's existing decision
(which client they constructed), not a second decision the driver asks
them to repeat.

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

### Requirement: A driver without session state guarantees its own statements
A driver that declares session state as `false` SHALL still deliver the
session settings the query layer's value conversion depends on, for the
statements it executes, by applying them as part of each execution rather
than once per connection. Declaring `false` SHALL NOT be read as
permission to let those settings go unapplied: the declaration describes
persistence between executions, not whether the settings hold for the
statement being run.

#### Scenario: The settings travel with the statement
- **WHEN** a driver declaring session state `false` executes a statement
- **THEN** what it sends carries those settings together with that
  statement, in that order, so the statement cannot run under a
  connection that never received them

#### Scenario: The declaration stays false
- **WHEN** such a driver's capabilities are examined
- **THEN** session state still reads `false`, because state does not
  persist from one execution to the next

## MODIFIED Requirements

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

#### Scenario: Neon driver plugs in unchanged on its session path
- **WHEN** a db handle is created with the Neon preset's driver built
  from a session-oriented client
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

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
