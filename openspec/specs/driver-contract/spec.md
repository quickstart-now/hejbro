# driver-contract Specification

## Purpose

Defines the capability-declaring driver interface through which the
query layer talks to a database, so execution features degrade with an
explicit error — never silently — on drivers that cannot support them.

## Requirements

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
For an `interval` column — single or array — `@hejbro/pg`'s per-query
type override SHALL deliver Postgres's raw text for that value to the
query layer's own conversion, never the underlying client library's own
pre-parsed interval object(s) — that object has no lossless way back to
text (its default string conversion discards all structure, and its own
text-rendering method reorders and reformats fields rather than
reproducing the original). The override SHALL intercept both the
scalar `interval` oid and the `interval` array oid; an interval array
therefore arrives as Postgres's raw array text. The override SHALL
additionally intercept the `numeric` array oid, delivering Postgres's
raw array text for it too: the client library's own default array
parser for that oid returns already-numeric-parsed JS numbers per
element, silently destroying the scale and precision a
`'string'`/`'bigint'`-mode `numeric` column's declared conversion
needs — unlike scalar `numeric`, which the client library already
leaves as raw text, and unlike `bigint` arrays, whose own default array
parser already returns text elements and therefore need no override.
Every other declared column type — every array oid other than
`interval`'s and `numeric`'s included — SHALL arrive in whatever shape
the underlying client library's own defaults produce, `format` argument
included; the override delegates to that default parser unchanged.

#### Scenario: A single interval column arrives as raw Postgres text
- **WHEN** a table declares a non-array `interval` column and a row
  is read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw interval text, not a pre-parsed object

#### Scenario: An interval array column arrives as raw array text
- **WHEN** a table declares an `interval` array column and a row is
  read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of pre-parsed objects

#### Scenario: A numeric array column arrives as raw array text
- **WHEN** a table declares a `numeric` array column and a row is read
  through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of already-parsed JS numbers — scale and
  precision (e.g. trailing zeros, or digits beyond
  `Number.MAX_SAFE_INTEGER`'s own limit) survive intact

#### Scenario: bigint, numeric, and timestamptz are read back in their declared shapes through a real db() handle
- **WHEN** a table declares a `bigint` column (default mode), a
  `numeric` column (`'string'` mode), and a `timestamptz` column, a row
  containing them exists in a real Postgres, and that row is read back
  through `@hejbro/pg` and a real `db()` handle
- **THEN** the `bigint` column reads back as a JS `bigint` exact beyond
  `Number.MAX_SAFE_INTEGER`, the `numeric` column reads back as the
  exact decimal text stored, and the `timestamptz` column reads back as
  a `Date` instance at the stored instant

#### Scenario: Other oids keep the client library's defaults
- **WHEN** a row carries columns of types other than `interval` or
  `numeric` (arrays included — `bigint` arrays included)
- **THEN** each value arrives in the underlying client library's own
  default shape for that oid, `format` argument respected — the
  override intercepts nothing else

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
again the next time it is checked out. The checkout path SHALL invoke
the session-setup hook through the driver value's own hook member —
late-bound, so a decorator that replaces or wraps that member takes
effect on every subsequent checkout — never through a captured
internal reference that bypasses the driver value.

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

#### Scenario: A wrapped session-setup hook takes effect at checkout
- **WHEN** the driver value's session-setup hook member is wrapped or
  replaced (for example by a preset decorator) and a fresh physical
  connection is checked out
- **THEN** the wrapped hook — not the original internal one — runs for
  that checkout's session setup

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

### Requirement: The missing-capability error has one definition
`@hejbro/query` SHALL export a thrower that constructs the driver
contract's own missing-capability failure. A driver package SHALL
construct this failure by calling that export, never by reproducing its
message text.

#### Scenario: A preset driver constructs the shared error
- **WHEN** a driver lacking a capability refuses an operation requiring it
- **THEN** it throws the error built by `@hejbro/query`'s exported
  thrower, carrying the same code, message, and enriched fields as any
  other driver's refusal for the same capability and operation

#### Scenario: The message text has no second copy
- **WHEN** any driver package's source is inspected
- **THEN** the missing-capability message text appears only inside
  `@hejbro/query`, and every other driver's refusal is produced by
  calling the export, not by restating the text

### Requirement: Every declared tier's obligation is machine-verified in this repository
A driver shipped from this repository SHALL be checked, at test time,
against the obligation its declared `session-state` tier carries: a
`false` declaration is checked for carrying its settings with every
execution, in that order; a `true` declaration is checked for delivering
them through its session-setup hook. This check observes order, not
content: it reads no driver's own settings text, so it cannot tell a
genuinely unrelated statement that merely precedes the caller's own from
the settings themselves — it checks only that some statement precedes
the caller's own for a `false` declaration, in the position the settings
would occupy if present. This is a deliberate limitation of what this
verification observes, not an oversight it is expected to close.

The check SHALL read which tier applies from the driver's own
capabilities declaration, never from a choice the caller makes
independently of it, and SHALL NOT use observed
behavior to infer, normalize, or correct the declaration itself — reading
the declaration to select an obligation is required; changing it from
what is observed is forbidden. This verification is repo-internal; it is
not part of any package's published surface, and a package that consumes
it internally SHALL wire the two resolution paths that need it
separately — a test runner's own module aliasing for the specifier at
test time, and the consuming package's own type-checker path mapping to
the same single file for type-checking, since a type-checker follows a
package's published `exports` map rather than a test runner's aliasing
and would not otherwise see an internal-only module. Exposing this
verification as a public export is additive and is deferred until a
driver author outside this repository needs it — deferring does not
modify this requirement.

#### Scenario: A driver that fails its declared tier's obligation is caught
- **WHEN** a driver's actual behavior does not carry out the obligation
  its own capabilities declare
- **THEN** a test run against it fails, naming which tier's obligation
  was not observed

#### Scenario: A driver checked against the wrong tier is refused, not silently passed
- **WHEN** a driver is checked with the observation shape for a tier
  other than the one its own capabilities declare
- **THEN** the check itself refuses, rather than silently applying the
  wrong obligation or passing without having checked anything

#### Scenario: A compliant driver's declaration is left unchanged
- **WHEN** a driver's behavior is checked against its declared tier and
  found compliant
- **THEN** its capabilities value reads exactly as it did before the
  check ran
