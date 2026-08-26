# Delta: driver-contract

## Purpose

Defines the capability-declaring driver interface through which the
query layer talks to a database, so execution features degrade with an
explicit error — never silently — on drivers that cannot support them.

## ADDED Requirements

### Requirement: Drivers declare their capabilities
A driver SHALL declare which execution capabilities it supports (at
minimum: interactive transactions, session state) as inspectable data on
the driver value. The query layer SHALL consult these declarations
instead of probing behavior at runtime.

#### Scenario: Capabilities are inspectable
- **WHEN** a driver value is examined before any connection is made
- **THEN** its declared capability set is readable and matches what the
  driver actually supports

### Requirement: The capability set is exhaustive and statically checked
The driver capability set SHALL be a fixed, enumerated set of named
capabilities (at minimum: interactive transactions, session state) —
never an open-ended list, and never a bare index signature. A driver
value's capability declaration SHALL name every capability in the set;
omitting one, or naming one outside the set, SHALL fail to type-check
rather than silently default. A mandatory prerequisite every driver
must supply just to be a driver at all (parameterized statement
execution) SHALL NOT be represented as a capability — it lives on the
driver's own required surface, unconditionally, never as a value that
could read `false`.

#### Scenario: Omitting a declared capability is a compile error
- **WHEN** a driver's capability declaration omits one of the fixed set's
  keys
- **THEN** the program fails to type-check

#### Scenario: Naming an undeclared capability is a compile error
- **WHEN** a driver's capability declaration includes a key outside the
  fixed set
- **THEN** the program fails to type-check

#### Scenario: A capability explicitly declared false fails closed
- **WHEN** a driver declares a capability as `false` (as opposed to
  omitting it)
- **THEN** an operation requiring that capability fails with the
  missing-capability error exactly as it would for an undeclared driver
  — `false` is never treated as "attempt it anyway"

### Requirement: Missing capability is an explicit error
When an operation requires a capability the active driver does not
declare, the query layer SHALL fail with an explicit error that names
the missing capability and the operation, before sending anything to
the database. Silent fallback to different semantics is forbidden.

#### Scenario: Transaction on a non-transactional driver
- **WHEN** a transaction (or any feature built on transactions) is
  attempted on a driver that does not declare interactive transactions
- **THEN** the call fails with an error identifying the missing
  capability, and no statement reaches the database

### Requirement: The contract carries a session-setup hook
The driver contract SHALL include a session-setup hook, invoked once
per newly acquired connection before that connection is handed to any
caller-visible operation. The hook's own presence is part of the
contract every driver implements; what a driver does inside it —
including pinning session-level output formatting (`IntervalStyle`) so
`interval` values parse deterministically regardless of the connecting
client's own default configuration — is that driver's responsibility,
not the query layer's.

#### Scenario: The session-setup hook is a mandatory driver field
- **WHEN** a driver value is constructed without its session-setup hook
- **THEN** the program fails to type-check

### Requirement: Vanilla Postgres driver
The `@hejbro/pg` package SHALL provide a driver for standard TCP
Postgres connections that declares interactive transactions and session
state, wrapping an existing client library rather than implementing a
wire protocol.

#### Scenario: Vanilla driver executes over TCP
- **WHEN** a db handle is created with the `@hejbro/pg` driver against a
  reachable Postgres and a compiled statement is executed
- **THEN** the statement runs over a TCP connection and transactions are
  available

### Requirement: Presets ship their own driver
A provider preset package SHALL be able to ship its own driver for its
platform's connection paths, built on the same contract with no special
cases in the query layer.

#### Scenario: Supabase driver plugs in unchanged
- **WHEN** a db handle is created with the Supabase preset's driver
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare
