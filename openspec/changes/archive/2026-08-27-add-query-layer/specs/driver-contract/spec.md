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
wire protocol. Both declared capabilities SHALL be `true` — a single
TCP connection to Postgres inherently supports `BEGIN`/`COMMIT` across
round trips and preserves `SET`-style session state across sequential
statements on the same connection.

#### Scenario: Vanilla driver executes over TCP
- **WHEN** a db handle is created with the `@hejbro/pg` driver against a
  reachable Postgres and a compiled statement is executed
- **THEN** the statement runs over a TCP connection and transactions are
  available

#### Scenario: Vanilla driver declares both capabilities true
- **WHEN** `@hejbro/pg`'s driver's capability declaration is examined
- **THEN** both `interactive-transactions` and `session-state` read
  `true`

### Requirement: Vanilla driver row arrival shapes
For a single (non-array) `interval` column, `@hejbro/pg`'s per-query
type override SHALL deliver Postgres's raw text for that value to the
query layer's own conversion, never the underlying client library's own
pre-parsed interval object — that object has no lossless way back to
text (its default string conversion discards all structure, and its own
text-rendering method reorders and reformats fields rather than
reproducing the original). Every other declared column type SHALL
arrive in whatever shape the underlying client library's own defaults
produce — the per-query override intercepts only the `interval` oid;
every other oid is delegated to the client library's own default
parser. This requirement does not extend to an `interval` array
column, whose element values reach a separate parser in the underlying
client library that this per-query override does not intercept, nor to
a `bigint`/`numeric` column declared with a non-default mode inside an
array — both are the same class of gap (array columns have no
result-conversion path at the layer above this driver), tracked
together as **#320**, that this driver does not paper over. The write
path for these same column types (an insert supplying a `bigint`/
`numeric` mode value or an `interval` value through the typed `insert()`
builder) is a separate, narrower gap tracked as **#322** — this
requirement makes no claim about it, only about values already present
in the database and read back.

#### Scenario: A single interval column arrives as raw Postgres text
- **WHEN** a table declares a non-array `interval` column and a row
  containing it is read back through `@hejbro/pg`
- **THEN** the value the query layer's own conversion receives is
  Postgres's raw interval text, not a pre-parsed object

#### Scenario: bigint, numeric, and timestamptz are read back in their declared shapes through a real db() handle
- **WHEN** a table declares a `bigint` column (default mode), a
  `numeric` column (`'string'` mode), and a `timestamptz` column, a row
  containing them exists in a real Postgres, and that row is read back
  through `@hejbro/pg` and a real `db()` handle
- **THEN** the `bigint` column reads back as a JS `bigint` exact beyond
  `Number.MAX_SAFE_INTEGER`, the `numeric` column reads back as the
  exact decimal text stored, and the `timestamptz` column reads back as
  a `Date` instance at the stored instant

### Requirement: Vanilla driver's session-setup hook pins IntervalStyle
`@hejbro/pg`'s driver's session-setup hook SHALL send `set intervalstyle
to 'postgres'` on the session it is given.

#### Scenario: The hook sends the pin
- **WHEN** `@hejbro/pg`'s driver's session-setup hook is invoked,
  directly, with a session
- **THEN** it sends `set intervalstyle to 'postgres'` on that session

### Requirement: Vanilla driver pins IntervalStyle at checkout
`@hejbro/pg`'s driver SHALL pin a physical connection it has not
successfully pinned before, before any caller-supplied statement runs
on it, on both the direct-execute path and the transaction path. It
SHALL NOT repeat the pin on a later checkout of a connection it has
already pinned successfully. A pin attempt that itself fails SHALL NOT
be treated as pinned — the same physical connection SHALL be pinned
again the next time it is checked out.

#### Scenario: The pin precedes the first caller statement, on either path
- **WHEN** `@hejbro/pg`'s driver checks out a physical connection it has
  not seen before, whether for a direct `execute` or for a `transaction`
- **THEN** it sends the IntervalStyle pin before any caller-supplied
  statement on that connection

#### Scenario: A reused connection is not pinned twice
- **WHEN** the same physical connection is checked out again after
  having already been pinned successfully
- **THEN** the pin is not sent again on that checkout

#### Scenario: A failed pin attempt is retried on the next checkout
- **WHEN** a pin attempt on a physical connection itself fails
- **THEN** that connection is not recorded as pinned, and the next
  checkout of the same physical connection attempts the pin again
  before any caller-supplied statement

### Requirement: Presets ship their own driver
A provider preset package SHALL be able to ship its own driver for its
platform's connection paths, built on the same contract with no special
cases in the query layer.

#### Scenario: Supabase driver plugs in unchanged
- **WHEN** a db handle is created with the Supabase preset's driver
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare
